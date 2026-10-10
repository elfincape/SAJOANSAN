param(
  [ValidateSet('bootstrap','migrate','test','workflow','test-workflow','templates','test-templates','http','http-edge','notion-config','notion','test-notion','notion-create','notion-sync','notion-http','notion-edge-http','notion-schema','sync-lock','notion-deploy')]
  [string]$Action='test'
)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
function Read-TaskCredential([string]$Name) {
  $encrypted=Get-Content -LiteralPath (Join-Path $taskRoot "staging-private/$Name.dpapi") -Raw
  $secure=ConvertTo-SecureString $encrypted.Trim()
  $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
try {
  $env:SUPABASE_PROJECT_REF='yvdialfqlbpjbbmcetev'
  $env:SUPABASE_ACCESS_TOKEN=Read-TaskCredential 'supabase'
  if($Action -in @('notion-config','notion-sync','notion-http','notion-edge-http','notion-schema')) {
    $env:OPERATIONS_NOTION_TOKEN=Read-TaskCredential 'notion'
    if($Action -eq 'notion-config') { & node (Join-Path $PSScriptRoot 'configure-operations-notion.mjs') }
    elseif($Action -eq 'notion-sync') { & node (Join-Path $PSScriptRoot 'operations-notion-cycle.mjs') }
    elseif($Action -eq 'notion-schema') { & node (Join-Path $PSScriptRoot 'operations-notion-cycle.mjs') '--schema' }
    elseif($Action -eq 'notion-edge-http') { & node (Join-Path $taskRoot 'tests/operations-notion-http.integration.mjs') '--edge' }
    else { & node (Join-Path $taskRoot 'tests/operations-notion-http.integration.mjs') }
  } elseif($Action -eq 'notion-deploy') {
    & node (Join-Path $PSScriptRoot 'deploy-operations-notion.mjs')
  } elseif($Action -eq 'http') {
    & node (Join-Path $taskRoot 'tests/operations-http.integration.mjs')
  } elseif($Action -eq 'http-edge') {
    & node (Join-Path $taskRoot 'tests/operations-http.integration.mjs') '--edge'
  } else {
    & node (Join-Path $PSScriptRoot 'operations-staging.mjs') $Action
  }
  exit $LASTEXITCODE
} finally {
  Remove-Item Env:SUPABASE_ACCESS_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:OPERATIONS_NOTION_TOKEN -ErrorAction SilentlyContinue
}
