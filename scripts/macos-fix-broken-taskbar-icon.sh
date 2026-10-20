APP="/Applications/Peppermint.app"

touch "$APP"
touch "$APP/Contents/Info.plist"

killall Dock
killall Finder