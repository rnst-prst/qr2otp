# Estrazione OTP da Google Authenticator

Converte i QR di esportazione di Google Authenticator in URI `otpauth://`
da importare in un altro gestore OTP. Per impostazione predefinita elenca
gli account senza mostrare i segreti. La decodifica avviene localmente
con zbarimg, protobufjs e hi-base32.

## Installazione

Servono Bash, Node.js 18 o successivo, npm e zbarimg.
Su Debian, dalla cartella del progetto:

```sh
sudo apt install zbar-tools
npm ci
```

`npm ci` installa le versioni fissate in `package-lock.json` e richiede
accesso al registro npm, salvo dipendenze già presenti nella cache.
Per l'esempio di importazione servono anche `pass` e la sua estensione `pass-otp`.

## Uso con webcam: senza salvare immagini

Su Linux si può leggere il QR mostrato sul telefono con una webcam tramite
`zbarcam`, anch'esso fornito da `zbar-tools`. Servono una webcam accessibile
all'utente, un ambiente grafico per la finestra di anteprima e un terminale
interattivo per scegliere l'account.

Per un solo account usare `--camera`, descritto qui sotto. Per importare
più account con un'unica acquisizione usare invece `--camera-save`,
descritto nella sezione successiva.

Avviare l'esportazione in Google Authenticator e, sul computer, eseguire:

```bash
set -o pipefail
./otp-codes.sh --camera | pass otp insert OTP/nickname
```

Il flusso è questo:

1. Si apre l'anteprima della webcam: inquadrare il QR mostrato sul telefono.
2. Se l'esportazione comprende più QR, mostrarli uno dopo l'altro, nella
   stessa sessione. Il terminale mostra quanti QR sono stati acquisiti;
   le letture ripetute dello stesso QR vengono ignorate.
3. Quando il batch è completo, compare l'elenco numerato degli account.
   Si può togliere il telefono dall'inquadratura: i dati sono già in memoria.
4. Digitare il numero dell'account e premere Invio. Solo il suo URI viene
   inviato a `pass`, nella voce `OTP/nickname` scelta nel comando.
5. Il programma termina e chiude il processo della webcam. Per annullare
   la scelta digitare `q`; durante l'acquisizione usare Ctrl+C.

Non occorre inquadrare una seconda volta il QR per passare dall'elenco
alla selezione. Non vengono salvati immagini, URI di migrazione o file
temporanei: `zbarcam` passa gli URI al decoder tramite stdin. Elenco e
richiesta di selezione usano `/dev/tty`, mentre stdout contiene solo l'URI
selezionato, così la pipe non riceve testo aggiuntivo.

Il dispositivo predefinito è `/dev/video0`. Per usarne un altro:

```bash
set -o pipefail
./otp-codes.sh --camera /dev/video1 | pass otp insert OTP/nickname
```

La sessione `--camera` esporta **un solo account**. Per importarne altri
con questa modalità occorre avviare una nuova sessione. Eseguire `--camera` senza una pipe stampa
l'URI selezionato, incluso il segreto, sul terminale. Se si chiude la
webcam prima di acquisire tutti i QR, il programma termina con errore
senza esportare alcun URI. QR non validi o di export diversi causano errore.

Riferimento per le opzioni di acquisizione:
[manuale di zbarcam](https://manpages.debian.org/testing/zbar-tools/zbarcam.1.en.html).

## Webcam: acquisire una volta e importare più account

L'opzione `--camera-save` legge tutti i QR dell'esportazione e salva i loro
URI di migrazione in un file temporaneo su tmpfs, uno per riga. Non salva
immagini. Quando il batch è completo e validato, **chiude la webcam e
stampa su stdout soltanto il percorso assoluto del file**. I messaggi di
avanzamento vanno su stderr, quindi si può raccogliere il percorso in una
variabile della shell senza includere altri testi.

Acquisire il batch dalla webcam predefinita:

```bash
otp_file=$(./otp-codes.sh --camera-save)
```

Proseguire solo se il comando termina con successo e `otp_file` contiene
un percorso. Per una webcam diversa usare
`otp_file=$(./otp-codes.sh --camera-save /dev/video1)`.

La webcam a questo punto è già chiusa. Si può elencare il contenuto del
file e riutilizzarlo per tutte le importazioni necessarie:

```bash
node index.js < "$otp_file"

set -o pipefail
node index.js --uri 1 < "$otp_file" | pass otp insert OTP/primo
node index.js --uri 2 < "$otp_file" | pass otp insert OTP/secondo
```

Per scegliere dall'elenco a ogni importazione, usare `--select`:

```bash
set -o pipefail
node index.js --select < "$otp_file" | pass otp insert OTP/altro
```

Terminati i controlli e le importazioni, rimuovere il file:

```bash
rm -- "$otp_file"
unset otp_file
```

Il file è creato con un nome casuale `migration-uris.XXXXXXXXXX.txt` e
permessi `600` nella directory `$XDG_RUNTIME_DIR`, oppure in
`/run/user/$(id -u)` se la variabile non è impostata. La directory deve
appartenere all'utente, avere permessi `700` e risiedere su tmpfs.
Se questi requisiti non sono soddisfatti, il comando fallisce: non ripiega
su `/tmp` o su una cartella del progetto.

Le letture duplicate vengono eliminate e gli URI vengono ordinati secondo
il batch. In caso di errore o interruzione gestita, il file provvisorio viene
rimosso e non viene restituito un percorso. Dopo un'acquisizione riuscita,
il file resta disponibile fino alla rimozione da parte dell'utente o allo
smontaggio del tmpfs. Un arresto forzato non intercettabile, come SIGKILL,
può lasciare il file provvisorio nella directory runtime.

Il file contiene i segreti dell'intera esportazione. Tmpfs evita un normale
file persistente, ma può usare la swap: non garantisce da solo che i dati
non raggiungano mai il disco. Vedere la
[documentazione del kernel su tmpfs](https://docs.kernel.org/filesystems/tmpfs.html).

## Uso: dalle immagini QR all'importazione

Il punto di partenza sono le **immagini dei QR di esportazione** di Google
Authenticator. Nel flusso normale non serve creare né procurarsi un file
`migration-uris.txt`: lo script legge direttamente le immagini.

Il passaggio dei dati è questo:

```text
Google Authenticator: esportazione degli account
    → immagini QR salvate sul computer
    → otp-codes.sh: zbarimg legge il contenuto dei QR
    → index.js: decodifica gli account
    → elenco degli account, oppure URI del singolo account scelto
```

### 1. Preparare le immagini

Avviare l'esportazione degli account in Google Authenticator e selezionare
gli account da trasferire. L'esportazione può produrre uno o più QR:
procurarsi un'immagine leggibile di ciascuno e trasferirle sul computer.
Servono i QR dell'esportazione, non i codici numerici OTP visualizzati
normalmente dall'app.

Conservare i QR e gli eventuali file con segreti nella cartella `private/`,
esclusa da Git:

```sh
mkdir -p private
chmod 700 private
```

Copiare qui le immagini dell'esportazione di Google Authenticator.
Negli esempi, `export.png` indica un'esportazione con un solo QR;
`export-1.png` e `export-2.png` indicano un'esportazione con due QR.
Sono nomi di esempio: usare i nomi dei propri file. Eseguire i comandi
seguenti dalla cartella del progetto.

### 2. Elencare gli account

Elencare gli account senza mostrare i segreti:

```sh
./otp-codes.sh private/export.png
```

Se l'esportazione comprende più QR, passarli tutti nello stesso comando:

```sh
./otp-codes.sh private/export-1.png private/export-2.png
```

Lo script stampa una riga per account: numero progressivo a partire da 1,
emittente e nome dell'account. Non stampa il segreto né i codici OTP.
Il numero serve a scegliere l'account nel passaggio successivo.

### 3. Importare un account in pass

Per esportare il solo account numero 3 dell'elenco direttamente in `pass`:

```bash
set -o pipefail
./otp-codes.sh --uri 3 private/export.png | pass otp insert OTP/nickname
```

Sostituire `3` con il numero desiderato e `OTP/nickname` con il nome della
voce da creare in `pass`. Usare le stesse immagini del passaggio precedente.
Anche per esportare un singolo account da un'esportazione con più QR,
occorre fornire tutte le immagini:

```bash
set -o pipefail
./otp-codes.sh --uri 3 private/export-1.png private/export-2.png | pass otp insert OTP/nickname
```

L'opzione `--uri` produce un URI `otpauth://` contenente il segreto e i
parametri necessari al gestore di destinazione per generare i codici OTP.
La pipe (`|`) lo trasmette a `pass otp insert` senza salvarlo in un file
intermedio. Ripetere il comando per ciascun account da importare.

Per vedere l'elenco e scegliere il numero in un'unica esecuzione, anche
con immagini già salvate, usare `--select` al posto di `--uri NUMERO`:

```bash
set -o pipefail
./otp-codes.sh --select private/export.png | pass otp insert OTP/nickname
```

L'elenco e la scelta vengono mostrati sul terminale; soltanto l'URI scelto
passa a `pass`. Anche qui si possono fornire più immagini dello stesso export.

`--uri` scrive il segreto su stdout: usarlo in pipe, o scegliere esplicitamente
una destinazione protetta. Questa modalità non crea file temporanei, non passa
gli URI nella riga di comando e non effettua richieste di rete.
Le immagini sorgenti rimangono a carico dell'utente.

Per le opzioni disponibili: `./otp-codes.sh --help`.

## Alternativa: URI di migrazione già estratti

Questa modalità legge gli URI salvati da `--camera-save` oppure già estratti
con un altro strumento. **Chi usa `otp-codes.sh` con le immagini può saltare
questa sezione.**

Ogni QR di esportazione contiene una stringa che inizia con
`otpauth-migration://offline?data=...`: è un URI di migrazione, il cui
payload codificato contiene i dati degli account. Non è ancora l'URI
`otpauth://` del singolo account da importare nel gestore di destinazione.

`migration-uris.txt` è semplicemente il nome di esempio di un file di testo
nel quale salvare questi URI già estratti, **uno completo per riga**.
Si può crearlo con un altro strumento oppure usare il file temporaneo
generato esplicitamente da `--camera-save`. Se l'esportazione comprende più QR, il file deve contenere
gli URI di tutti i QR di quella stessa esportazione.

Per elencare gli account leggendo quel file direttamente con il decoder:

```sh
node index.js < private/migration-uris.txt
```

Il simbolo `<` fa leggere al programma il contenuto del file tramite stdin.
Si può selezionare un account anche in questa modalità:

```bash
set -o pipefail
node index.js --uri 3 < private/migration-uris.txt | pass otp insert OTP/nickname
```

Sostituendo `--uri 3` con `--select` si sceglie l'account interattivamente,
senza rileggere il file in un secondo comando. L'opzione del decoder
`--scan` è usata dal wrapper per uno stream live: ignora QR ripetuti e
conclude la lettura al completamento del batch, senza attendere la fine
dello stream. Per i file, usare normalmente la modalità senza `--scan`,
che verifica l'intero input e rifiuta anche i duplicati.

Questo file contiene i segreti degli account, proprio come le immagini QR.
Nel flusso normale `otp-codes.sh` passa gli URI estratti direttamente a
`index.js` tramite stdin, evitando la necessità di salvarli su disco.

## Compatibilità e gestione dei segreti

Le esportazioni multiple devono appartenere allo stesso batch ed essere
complete; l'ordine dei file non conta. Non vengono unite esportazioni diverse.
Algoritmi SHA1/SHA256/SHA512, 6/8 cifre e HOTP/TOTP sono preservati; parametri
non riconosciuti causano errore. Il formato di migrazione non include il
periodo TOTP: viene usato 30 secondi. Confrontare sempre il risultato col
telefono prima di eliminare le esportazioni.

Il `.gitignore` esclude anche i formati immagine comuni e alcuni nomi di
file di esportazione. Non protegge file con nomi arbitrari fuori da
`private/`: verificare sempre i file aggiunti prima di un commit.

Formato URI di destinazione:
https://github.com/google/google-authenticator/wiki/Key-Uri-Format

## Sviluppo

Eseguire i test sintetici (nessun segreto reale):

```sh
npm test
```

- `otp-codes.sh`: lettura dei QR tramite zbarimg o zbarcam.
- `index.js`: decodifica, verifica dei batch ed esportazione degli URI.
- `migration-payload.proto`: schema del payload di migrazione.
- `test.js`: test del decoder e della CLI.

Le note sulle correzioni precedenti sono in [CHANGELOG.md](CHANGELOG.md).
L'aggiornamento e l'audit delle dipendenze restano da eseguire separatamente.
