param(
  [ValidateSet('bootstrap','migrate','test','workflow','test-workflow','templates','test-templates','http','notion-config')]
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
  if($Action -eq 'notion-config') {
    $env:OPERATIONS_NOTION_TOKEN=Read-TaskCredential 'notion'
    & node (Join-Path $PSScriptRoot 'configure-operations-notion.mjs')
  } elseif($Action -eq 'http') {
    & node (Join-Path $taskRoot 'tests/operations-http.integration.mjs')
  } else {
    & node (Join-Path $PSScriptRoot 'operations-staging.mjs') $Action
  }
  exit $LASTEXITCODE
} finally {
  Remove-Item Env:SUPABASE_ACCESS_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:OPERATIONS_NOTION_TOKEN -ErrorAction SilentlyContinue
}
