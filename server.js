const express = require('express');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const SECRET = 'tfs_serwis_tajny_klucz_2024'; // IDENTYCZNY jak w programie
const TWOJ_EMAIL = 'dawidek.zkw@gmail.com';
const ADRES_SERWERA = 'https://tfs-license.onrender.com'; // podmien jesli adres sie zmieni

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

// --- BEZPIECZNY, PODPISANY LINK ZATWIERDZAJACY (bez bazy danych) ---
// Kodujemy dane zgloszenia + termin waznosci linku wprost w adresie URL,
// podpisujac je HMAC-em, zeby nikt nie mogl podrobic/zmienic tresci zgloszenia.

const WAZNOSC_LINKU_MS = 7 * 24 * 60 * 60 * 1000; // link do zatwierdzenia wazny 7 dni

function podpiszDane(obj) {
    const json = JSON.stringify(obj);
    const dataB64 = Buffer.from(json).toString('base64url');
    const podpis = crypto.createHmac('sha256', SECRET).update(dataB64).digest('hex');
    return { dataB64, podpis };
}

function zweryfikujDane(dataB64, podpis) {
    const oczekiwanyPodpis = crypto.createHmac('sha256', SECRET).update(dataB64).digest('hex');
    if (oczekiwanyPodpis !== podpis) return null;
    try {
        const json = Buffer.from(dataB64, 'base64url').toString('utf8');
        return JSON.parse(json);
    } catch (e) {
        return null;
    }
}

// --- ZGLOSZENIE KLIENTA: wysyla do Ciebie maila z prosba o zatwierdzenie ---
app.post('/request-license', async (req, res) => {
    const { machine_id, klient_email } = req.body;
    const dni = 365; // zawsze roczna licencja

    if (!machine_id || !klient_email) {
        return res.status(400).json({ error: 'Brak wymaganych danych' });
    }

    try {
        const waznyDo = Date.now() + WAZNOSC_LINKU_MS;
        const { dataB64, podpis } = podpiszDane({ machine_id, klient_email, dni, waznyDo });
        const linkZatwierdzenia = `${ADRES_SERWERA}/approve?data=${encodeURIComponent(dataB64)}&sig=${podpis}`;

        // Mail do Ciebie z prosba o zatwierdzenie
        await transporter.sendMail({
            from: TWOJ_EMAIL,
            to: TWOJ_EMAIL,
            subject: `Nowe zgłoszenie o licencję - ${klient_email}`,
            html: `
                <p>Ktoś prosi o klucz licencyjny TFS Serwis:</p>
                <p>
                    <b>Klient:</b> ${klient_email}<br>
                    <b>ID maszyny:</b> ${machine_id}<br>
                    <b>Liczba dni:</b> ${dni}
                </p>
                <p>
                    <a href="${linkZatwierdzenia}" style="display:inline-block; padding:12px 24px; background:#4CAF50; color:#fff; text-decoration:none; border-radius:6px; font-weight:bold;">
                        ✅ Zatwierdź i wyślij klucz
                    </a>
                </p>
                <p style="color:#888; font-size:12px;">Link ważny 7 dni.</p>
            `
        });

        // Potwierdzenie dla klienta, ze zgloszenie dotarlo
        await transporter.sendMail({
            from: TWOJ_EMAIL,
            to: klient_email,
            subject: 'Otrzymaliśmy Twoje zgłoszenie - TFS Serwis',
            text: `Dziękujemy za zgłoszenie prośby o licencję TFS Serwis.\n\nTwoje zgłoszenie czeka na zatwierdzenie. Klucz licencyjny otrzymasz na ten adres e-mail, gdy tylko zostanie zaakceptowane.\n\nPozdrawiamy,\nTFS Serwis`
        });

        res.json({ success: true });
    } catch (e) {
        console.error('Błąd zgłoszenia licencji:', e);
        res.status(500).json({ error: 'Błąd serwera' });
    }
});

// --- ZATWIERDZENIE: klikniete z Twojego maila, generuje i wysyla klucz ---
app.get('/approve', async (req, res) => {
    const { data, sig } = req.query;

    if (!data || !sig) {
        return res.status(400).send('<h2>❌ Brak danych w linku.</h2>');
    }

    const zgloszenie = zweryfikujDane(data, sig);

    if (!zgloszenie) {
        return res.status(400).send('<h2>❌ Nieprawidłowy lub uszkodzony link.</h2>');
    }

    if (Date.now() > zgloszenie.waznyDo) {
        return res.status(400).send('<h2>⏰ Ten link wygasł (był ważny 7 dni). Poproś klienta o nowe zgłoszenie.</h2>');
    }

    try {
        const { encoded, expires } = generateKey(zgloszenie.dni, zgloszenie.machine_id);
        const dataWygasniecia = new Date(expires).toLocaleDateString('pl-PL');

        await transporter.sendMail({
            from: TWOJ_EMAIL,
            to: zgloszenie.klient_email,
            subject: 'Twój klucz licencyjny TFS Serwis',
            text: `
Dziękujemy za cierpliwość!

Twój klucz licencyjny (${zgloszenie.dni} dni, wygasa ${dataWygasniecia}):

${encoded}

Aby aktywować licencję, wpisz powyższy klucz w programie TFS Serwis.

Pozdrawiamy,
TFS Serwis
            `
        });

        res.send(`
            <h2>✅ Zatwierdzono!</h2>
            <p>Klucz licencyjny został wysłany na adres: <b>${zgloszenie.klient_email}</b></p>
            <p>ID maszyny: ${zgloszenie.machine_id}</p>
            <p>Klucz: <code>${encoded}</code></p>
        `);
    } catch (e) {
        console.error('Błąd zatwierdzania licencji:', e);
        res.status(500).send('<h2>❌ Błąd podczas wysyłania klucza. Sprawdź logi serwera.</h2>');
    }
});

app.get('/', (req, res) => res.send('TFS License Server działa!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serwer działa na porcie ${PORT}`));


