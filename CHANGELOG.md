# Note sulle modifiche

## Modifiche non ancora rilasciate

- Il progetto e il comando si chiamano `qr2otp`; lo script sostituisce `otp-codes.sh`.

- `--camera-save` salva un batch validato in un file privato su tmpfs,
  chiude la webcam e restituisce il percorso per importazioni successive.
- Acquisizione dei QR da webcam con `--camera`, senza file intermedi.
- Raccolta live dei batch completi con deduplicazione delle letture ripetute.
- Selezione interattiva con `--select`: elenco e scelta sul terminale,
  solo l'URI selezionato su stdout.

## Modifiche precedenti alla creazione del repository

- Il wrapper originario mostrava il payload e lo passava come argomento;
  ora lo trasmette al decoder tramite stdin senza stamparlo.
- I percorsi del decoder sono risolti rispetto agli script e gli errori
  di zbar interrompono l'esecuzione.
- Il decoder originario verificava i byte come se fossero un oggetto
  protobuf e scartava i parametri OTP. Il decoder attuale legge il payload,
  verifica la completezza dei batch e preserva i parametri supportati.

Le dipendenze esistenti sono state mantenute. Il loro aggiornamento e
l'audit delle dipendenze restano una verifica separata.
