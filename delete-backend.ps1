# Delete Firebase App Hosting backend
$env:FIREBASE_TOKEN = ""

Write-Host "Attempting to delete backend..."

# Use --force flag if available
firebase apphosting:backends:delete backend-gadgets --project gadgets-83800 --force 2>&1

Write-Host "Done"
