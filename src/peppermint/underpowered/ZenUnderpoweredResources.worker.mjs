/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* globals ctypes */

/**
 * Reads how busy the whole machine is, not just this browser, off the main
 * thread.
 *
 * In:  { platform: "macosx" | "win" | "linux" }  (AppConstants.platform)
 * Out: { cpu: number|null, ram: number|null }    (percent, 0 to 100)
 *
 * CPU is the share of non-idle time since the previous message, so the first
 * answer has no CPU value. Anything that cannot be read answers null.
 */

const UINT32 = 2 ** 32;

function percent(value) {
  return Math.min(100, Math.max(0, value));
}

// macOS

const HOST_CPU_LOAD_INFO = 3;
const CPU_STATE_IDLE = 2;
const CPU_STATE_COUNT = 4;

function macReader() {
  const lib = ctypes.open("/usr/lib/libSystem.B.dylib");
  const hostSelf = lib.declare(
    "mach_host_self",
    ctypes.default_abi,
    ctypes.uint32_t
  );
  const hostStatistics = lib.declare(
    "host_statistics",
    ctypes.default_abi,
    ctypes.int32_t,
    ctypes.uint32_t,
    ctypes.int32_t,
    ctypes.voidptr_t,
    ctypes.uint32_t.ptr
  );
  const sysctlByName = lib.declare(
    "sysctlbyname",
    ctypes.default_abi,
    ctypes.int32_t,
    ctypes.char.ptr,
    ctypes.voidptr_t,
    ctypes.size_t.ptr,
    ctypes.voidptr_t,
    ctypes.size_t
  );
  const Ticks = new ctypes.ArrayType(ctypes.uint32_t, CPU_STATE_COUNT);
  const host = hostSelf();
  let previous = null;

  return {
    sample() {
      let cpu = null;
      const ticks = new Ticks();
      const count = new ctypes.uint32_t(CPU_STATE_COUNT);
      if (
        hostStatistics(
          host,
          HOST_CPU_LOAD_INFO,
          ticks.address(),
          count.address()
        ) === 0
      ) {
        const current = Array.from({ length: CPU_STATE_COUNT }, (_, i) =>
          Number(ticks[i])
        );
        if (previous) {
          // The counters are 32 bit and wrap around.
          const delta = current.map(
            (n, i) => (n - previous[i] + UINT32) % UINT32
          );
          const total = delta.reduce((sum, n) => sum + n, 0);
          if (total > 0) {
            cpu = percent(100 * (1 - delta[CPU_STATE_IDLE] / total));
          }
        }
        previous = current;
      }

      // The share of memory the system could hand out without swapping more,
      // the same number its memory pressure is derived from.
      let ram = null;
      const level = new ctypes.int32_t();
      const size = new ctypes.size_t(4);
      if (
        sysctlByName(
          "kern.memorystatus_level",
          level.address(),
          size.address(),
          null,
          0
        ) === 0
      ) {
        ram = percent(100 - level.value);
      }
      return { cpu, ram };
    },
  };
}

// Windows

function windowsReader() {
  const kernel32 = ctypes.open("kernel32.dll");
  const FileTime = new ctypes.StructType("FILETIME", [
    { low: ctypes.uint32_t },
    { high: ctypes.uint32_t },
  ]);
  const getSystemTimes = kernel32.declare(
    "GetSystemTimes",
    ctypes.winapi_abi,
    ctypes.int32_t,
    FileTime.ptr,
    FileTime.ptr,
    FileTime.ptr
  );
  const MemoryStatus = new ctypes.StructType("MEMORYSTATUSEX", [
    { dwLength: ctypes.uint32_t },
    { dwMemoryLoad: ctypes.uint32_t },
    { ullTotalPhys: ctypes.uint64_t },
    { ullAvailPhys: ctypes.uint64_t },
    { ullTotalPageFile: ctypes.uint64_t },
    { ullAvailPageFile: ctypes.uint64_t },
    { ullTotalVirtual: ctypes.uint64_t },
    { ullAvailVirtual: ctypes.uint64_t },
    { ullAvailExtendedVirtual: ctypes.uint64_t },
  ]);
  const globalMemoryStatus = kernel32.declare(
    "GlobalMemoryStatusEx",
    ctypes.winapi_abi,
    ctypes.int32_t,
    MemoryStatus.ptr
  );
  const toNumber = time => time.high * UINT32 + time.low;
  let previous = null;

  return {
    sample() {
      let cpu = null;
      const idle = new FileTime();
      const kernel = new FileTime();
      const user = new FileTime();
      if (
        getSystemTimes(idle.address(), kernel.address(), user.address()) !== 0
      ) {
        // Kernel time includes idle time.
        const current = {
          idle: toNumber(idle),
          total: toNumber(kernel) + toNumber(user),
        };
        if (previous) {
          const total = current.total - previous.total;
          if (total > 0) {
            cpu = percent(100 * (1 - (current.idle - previous.idle) / total));
          }
        }
        previous = current;
      }

      let ram = null;
      const status = new MemoryStatus();
      status.dwLength = MemoryStatus.size;
      if (globalMemoryStatus(status.address()) !== 0) {
        ram = percent(status.dwMemoryLoad);
      }
      return { cpu, ram };
    },
  };
}

// Linux

function linuxReader() {
  let previous = null;

  return {
    async sample() {
      let cpu = null;
      const stat = await IOUtils.readUTF8("/proc/stat");
      // cpu user nice system idle iowait irq softirq steal
      const fields = stat
        .split("\n", 1)[0]
        .trim()
        .split(/\s+/)
        .slice(1, 9)
        .map(Number);
      if (fields.length === 8 && fields.every(Number.isFinite)) {
        const current = {
          idle: fields[3] + fields[4],
          total: fields.reduce((sum, n) => sum + n, 0),
        };
        if (previous) {
          const total = current.total - previous.total;
          if (total > 0) {
            cpu = percent(100 * (1 - (current.idle - previous.idle) / total));
          }
        }
        previous = current;
      }

      let ram = null;
      const meminfo = await IOUtils.readUTF8("/proc/meminfo");
      const total = Number(/^MemTotal:\s+(\d+)/m.exec(meminfo)?.[1]);
      const available = Number(/^MemAvailable:\s+(\d+)/m.exec(meminfo)?.[1]);
      if (total > 0 && Number.isFinite(available)) {
        ram = percent(100 * (1 - available / total));
      }
      return { cpu, ram };
    },
  };
}

const READERS = {
  macosx: macReader,
  win: windowsReader,
  linux: linuxReader,
};

let reader = null;

self.onmessage = async event => {
  let reply = { cpu: null, ram: null };
  try {
    reader ??= READERS[event.data?.platform]?.();
    if (reader) {
      reply = await reader.sample();
    }
  } catch (e) {
    // Leave the empty reply.
  }
  self.postMessage(reply);
};
