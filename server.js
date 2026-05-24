const express = require('express');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const SECRET = 'tfs_serwis_tajny_klucz_2024'; // IDENTYCZNY jak w programie

// Konfiguracja maila - wpisz swoje dane Gmail
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'dawidek.zkw@gmail.com',
        pass: 'TWOJE_HASLO_APLIKACJI' // hasło aplikacji z Google, nie zwykłe hasło
    }
});

function generateKey(days, machineId) {
    const expires = Date.now() + (days * 24 * 60 * 60 * 1000);
    const payload = `${expires}:${days}:${machineId}`;
    const hash = crypto.createHmac('sha256', SECRET)
                       .update(payload)
                       .digest('hex')
                       .substring(0, 8)
                       .toUpperCase();
    
    const key = `TFS-${hash}-${expires}-${days}-${machineId}`;
    
    const encoded = Buffer.from(key).toString('base64')
                          .replace(/=/g, '')
                          .match(/.{1,6}/g)
                          .join('-');
    
    return { encoded, expires, days };
}

// Endpoint który wywołuje program klienta
app.post('/request-license', async (req, res) => {
    const { machine_id, klient_email, dni } = req.body;

    if (!machine_id || !klient_email || !dni) {
        return res.status(400).json({ error: 'Brak wymaganych danych' });
    }

    try {
        const { encoded, expires } = generateKey(parseInt(dni), machine_id);
        const dataWygasniecia = new Date(expires).toLocaleDateString('pl-PL');

        // Wyślij klucz do klienta
        await transporter.sendMail({
            from: 'dawidek.zkw@gmail.com',
            to: klient_email,
            subject: 'Twój klucz licencyjny TFS Serwis',
            text: `
Dziękujemy za zakup licencji TFS Serwis!

Twój klucz licencyjny (${dni} dni, wygasa ${dataWygasniecia}):

${encoded}

Aby aktywować licencję, wpisz powyższy klucz w programie TFS Serwis.

Pozdrawiamy,
TFS Serwis
            `
        });

        // Wyślij powiadomienie do Ciebie
        await transporter.sendMail({
            from: 'dawidek.zkw@gmail.com',
            to: 'dawidek.zkw@gmail.com',
            subject: `Nowa licencja wydana - ${klient_email}`,
            text: `
Wydano nową licencję:

Klient: ${klient_email}
ID maszyny: ${machine_id}
Liczba dni: ${dni}
Wygasa: ${dataWygasniecia}
Klucz: ${encoded}
            `
        });

        res.json({ success: true });

    } catch(e) {
        console.error('Błąd:', e);
        res.status(500).json({ error: 'Błąd serwera' });
    }
});

app.get('/', (req, res) => res.send('TFS License Server działa!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serwer działa na porcie ${PORT}`));
