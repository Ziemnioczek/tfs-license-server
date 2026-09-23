const express = require('express');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Gumroad wysyla dane jako form-urlencoded

const SECRET = 'tfs_serwis_tajny_klucz_2024'; // IDENTYCZNY jak w programie

// Twoj Seller ID z Gumroad (Settings -> Advanced), zeby odrzucac fałszywe zgloszenia na ten adres
const GUMROAD_SELLER_ID = process.env.GUMROAD_SELLER_ID || '';

// Konfiguracja maila - Brevo SMTP
const transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 2525,
    auth: {
        user: process.env.BREVO_USER,
        pass: process.env.BREVO_KEY
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

async function wyslijKlucz(machineId, klientEmail, dni) {
    const { encoded, expires } = generateKey(dni, machineId);
    const dataWygasniecia = new Date(expires).toLocaleDateString('pl-PL');

    // Wyslij klucz do klienta
    await transporter.sendMail({
        from: 'dawidek.zkw@gmail.com',
        to: klientEmail,
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

    // Wyslij powiadomienie do Ciebie
    await transporter.sendMail({
        from: 'dawidek.zkw@gmail.com',
        to: 'dawidek.zkw@gmail.com',
        subject: `Nowa licencja wydana (Gumroad) - ${klientEmail}`,
        text: `
Wydano nową licencję po opłaceniu na Gumroad:

Klient: ${klientEmail}
ID maszyny: ${machineId}
Liczba dni: ${dni}
Wygasa: ${dataWygasniecia}
Klucz: ${encoded}
        `
    });
}

// --- WEBHOOK Z GUMROAD (Ping) ---
// Ustawienia na Gumroad: Settings -> Advanced -> Ping endpoint:
// https://tfs-license.onrender.com/gumroad-webhook
app.post('/gumroad-webhook', async (req, res) => {
    // Gumroad odpowiedzi 200 traktuje jako "odebrano" - zawsze odpowiadamy szybko,
    // a ewentualne bledy logujemy, zeby Gumroad nie probowal spamowac ponownymi probami.
    try {
        const dane = req.body;

        // Podstawowa ochrona: sprawdz czy sprzedaz jest z Twojego konta Gumroad
        if (GUMROAD_SELLER_ID && dane.seller_id !== GUMROAD_SELLER_ID) {
            console.warn('Odrzucono webhook - inny seller_id:', dane.seller_id);
            return res.status(200).send('ignored');
        }

        const klientEmail = dane.email || dane.purchaser_email;
        // Nazwa pola musi byc IDENTYCZNA jak etykieta pola niestandardowego w Gumroad ("Machine ID")
        const machineId = dane['custom_fields[Machine ID]'] || dane.machine_id;
        const dni = 365; // ten produkt to zawsze licencja roczna

        if (!klientEmail || !machineId) {
            console.error('Brak wymaganych danych w webhooku Gumroad:', dane);
            return res.status(200).send('missing data'); // 200, zeby Gumroad nie ponawial w kolko
        }

        await wyslijKlucz(machineId, klientEmail, dni);
        res.status(200).send('ok');
    } catch (e) {
        console.error('Błąd obsługi webhooka Gumroad:', e);
        res.status(200).send('error logged'); // 200 mimo bledu, zeby uniknac zalewu ponownych prob
    }
});

app.get('/', (req, res) => res.send('TFS License Server działa!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serwer działa na porcie ${PORT}`));


