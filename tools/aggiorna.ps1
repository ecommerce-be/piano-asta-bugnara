# Un comando solo per rimettersi in pari e controllare che sia tutto a posto.
#
#     .\tools\aggiorna.ps1              porta a casa gli aggiornamenti e controlla
#     .\tools\aggiorna.ps1 -Apri        apre anche il listone nel browser
#     .\tools\aggiorna.ps1 -SoloPull    solo il pull, niente controlli
#
# PERCHE' ESISTE. Il listone si aggiorna DA SOLO ogni mattina: lo fa la GitHub
# Action, che legge Fantacalcio.it e fa commit da sola. Il sito pubblicato e'
# quindi sempre in pari senza che nessuno tocchi niente.
#
# Quello che restava a mano era il contorno: tirare giu' quel commit sulla
# copia locale, aprire un'altra finestra per il server, lanciare i controlli,
# ricordarsi di spegnere il server. Con due profili Windows che lavorano sullo
# stesso progetto, saltare il primo passo vuol dire lavorare su una versione
# vecchia e scoprirlo quando e' gia' un conflitto.
#
# Qui succede tutto in fila, e il server viene acceso e spento da questo
# script: non resta una finestra aperta a occupare la porta.

param(
    [switch]$Apri,
    [switch]$SoloPull,
    [int]$Porta = 8123
)

$ErrorActionPreference = 'Stop'
$radice = Split-Path -Parent $PSScriptRoot
Set-Location $radice

function Titolo($t) { Write-Host "`n— $t —" -ForegroundColor Cyan }

# ---------------------------------------------------------------- 1. pull

Titolo 'porto a casa gli aggiornamenti'

# Un comando git interrotto lascia .git/index.lock, e da li' in poi ogni altro
# comando git fallisce con un messaggio che non spiega niente. Se c'e' ed e'
# vecchio di piu' di un minuto, nessuno lo sta usando davvero.
$lock = Join-Path $radice '.git\index.lock'
if (Test-Path $lock) {
    $eta = (Get-Date) - (Get-Item $lock).LastWriteTime
    if ($eta.TotalSeconds -gt 60) {
        Write-Host '  tolgo un .git\index.lock rimasto da un comando interrotto' -ForegroundColor Yellow
        Remove-Item $lock -Force
    }
}

$sporco = git --no-optional-locks status --porcelain
if ($sporco) {
    Write-Host '  ATTENZIONE: hai modifiche non salvate. Il pull si ferma qui.' -ForegroundColor Yellow
    Write-Host '  Committale (git add -A ; git commit -m "...") oppure buttale via (git checkout -- .),'
    Write-Host '  poi rilancia. Le modifiche in sospeso:'
    $sporco | ForEach-Object { Write-Host "    $_" }
    exit 1
}

# Le due copie (i due profili Windows) si incontrano solo su GitHub, e ci si
# arriva anche da un'altra strada: modificando un file direttamente dal sito —
# il workflow, per esempio, che da qui non si può scrivere. In quel caso i due
# rami hanno ognuno un commit che l'altro non ha, `pull --ff-only` si rifiuta,
# e il push viene respinto con un messaggio che non dice cosa fare.
# Qui si guarda prima com'è messa la situazione, e si sceglie di conseguenza.
$prima = git rev-parse HEAD
git fetch --quiet origin
$indietro = [int](git rev-list --count "HEAD..@{u}" 2>$null)
$avanti = [int](git rev-list --count "@{u}..HEAD" 2>$null)

if ($indietro -gt 0 -and $avanti -gt 0) {
    Write-Host "  i due rami si sono separati ($avanti commit tuoi, $indietro su GitHub): li unisco." -ForegroundColor Yellow
    git -c core.editor=true pull --no-rebase --no-edit
} elseif ($indietro -gt 0) {
    git -c core.editor=true pull --ff-only
}

$dopo = git rev-parse HEAD

if ($prima -eq $dopo) {
    Write-Host '  eri già in pari: niente di nuovo su GitHub.'
} else {
    Write-Host '  arrivati:' -ForegroundColor Green
    git --no-optional-locks log --oneline "$prima..$dopo" | ForEach-Object { Write-Host "    $_" }
}

# Commit fatti e mai pubblicati: è il modo più facile di credere che una cosa
# sia online quando non lo è.
$daPubblicare = [int](git rev-list --count "@{u}..HEAD" 2>$null)
if ($daPubblicare -gt 0) {
    Write-Host "  hai $daPubblicare commit non ancora su GitHub: ricordati «git push»." -ForegroundColor Yellow
}

# che eta' hanno i dati, detto in chiaro
$app = Get-Content 'assets\app.js' -Raw
if ($app -match "AGGIORNATO_IL = '([^']+)'") {
    $quando = [datetime]::Parse($Matches[1])
    $giorni = [int]((Get-Date).Date - $quando.Date).TotalDays
    $eta = switch ($giorni) { 0 { 'oggi' } 1 { 'ieri' } default { "$giorni giorni fa" } }
    Write-Host "  dati cambiati l'ultima volta il $($quando.ToString('dd/MM/yyyy')) ($eta)"
}

# Le due date rispondono a due domande diverse: «i dati sono cambiati?» e
# «qualcuno è andato a guardare?». La seconda è quella che dice se
# l'aggiornamento automatico è vivo, ed è quella che conta prima dell'asta.
if ($app -match "CONTROLLATO_IL = '([^']+)'") {
    $ctrl = [datetime]::Parse($Matches[1])
    $gg = [int]((Get-Date).Date - $ctrl.Date).TotalDays
    $etaC = switch ($gg) { 0 { 'oggi' } 1 { 'ieri' } default { "$gg giorni fa" } }
    Write-Host "  ultimo controllo automatico: $($ctrl.ToString('dd/MM/yyyy')) ($etaC)"
    if ($gg -ge 2) {
        Write-Host "  ATTENZIONE: l'aggiornamento automatico non gira da $gg giorni." -ForegroundColor Yellow
        Write-Host '  Guarda su GitHub: scheda Actions → Aggiorna dati giocatori,' -ForegroundColor Yellow
        Write-Host '  e se serve lancialo a mano con «Run workflow».' -ForegroundColor Yellow
    }
}

if ($SoloPull) { exit 0 }

# ------------------------------------------------------- 2. server e controlli

Titolo "accendo il server sulla porta $Porta"

$server = Start-Process -PassThru -WindowStyle Hidden `
    -FilePath 'python' -ArgumentList '-m', 'http.server', "$Porta"
Start-Sleep -Seconds 2

try {
    if ($Apri) { Start-Process "http://localhost:$Porta/listone.html" }
    Titolo 'controlli'
    node tools\coerenza.mjs "http://localhost:$Porta/"
    $esito = $LASTEXITCODE
} finally {
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    Write-Host "`n(server spento)"
}

exit $esito
