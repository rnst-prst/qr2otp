# Note sulle modifiche

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
