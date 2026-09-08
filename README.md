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

`--uri` scrive il segreto su stdout: usarlo in pipe, o scegliere esplicitamente
una destinazione protetta. Il programma non crea file temporanei, non passa
gli URI nella riga di comando e non effettua richieste di rete.
Le immagini sorgenti rimangono a carico dell'utente.

Per le opzioni disponibili: `./otp-codes.sh --help`.

## Alternativa: URI di migrazione già estratti

Questa modalità serve solo se si è già letto il contenuto dei QR con un
altro strumento. **Chi usa `otp-codes.sh` con le immagini può saltare
questa sezione.**

Ogni QR di esportazione contiene una stringa che inizia con
`otpauth-migration://offline?data=...`: è un URI di migrazione, il cui
payload codificato contiene i dati degli account. Non è ancora l'URI
`otpauth://` del singolo account da importare nel gestore di destinazione.

`migration-uris.txt` è semplicemente il nome di esempio di un file di testo
creato dall'utente, nel quale salvare questi URI già estratti, **uno completo
per riga**. Non è un file fornito dal progetto né generato automaticamente
dal wrapper. Se l'esportazione comprende più QR, il file deve contenere
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

- `otp-codes.sh`: lettura dei QR tramite zbarimg.
- `index.js`: decodifica, verifica dei batch ed esportazione degli URI.
- `migration-payload.proto`: schema del payload di migrazione.
- `test.js`: test del decoder e della CLI.

Le note sulle correzioni precedenti sono in [CHANGELOG.md](CHANGELOG.md).
L'aggiornamento e l'audit delle dipendenze restano da eseguire separatamente.
