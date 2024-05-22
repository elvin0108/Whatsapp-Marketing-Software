const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const ExcelJS = require('exceljs');

const app = express();
const port = 3000;

app.use(bodyParser.json());

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { headless: true, args: ['--no-sandbox', '--disable-gpu'] },
    webVersionCache: { type: 'remote', remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html' }
});

client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Client is ready!');
});

client.initialize();

client.on('message', async (msg) => {
    if (msg.body === 'ping') {
        await msg.reply('pong');
    }
});

app.post('/send-message', async (req, res) => {
    const { message, attachmentPath, minDelay, maxDelay } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    if (minDelay === undefined || maxDelay === undefined) {
        return res.status(400).json({ error: 'Missing delay configuration' });
    }

    try {
        const numbers = await readNumbersFromExcel();
        await sendMessagesWithDelay(numbers, message, attachmentPath, minDelay, maxDelay);
        res.status(200).json({ message: 'Messages sent successfully' });
    } catch (error) {
        console.error('Error sending messages:', error);
        res.status(500).json({ error: 'Failed to send messages' });
    }
});

async function readNumbersFromExcel() {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile('numbers.xlsx');
    const worksheet = workbook.getWorksheet(1);
    const numbers = [];
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) {
            const number = row.getCell(1).value;
            if (number) {
                numbers.push(number);
            }
        }
    });
    return numbers;
}

async function sendMessagesWithDelay(numbers, message, attachmentPath, minDelay, maxDelay) {
    for (const number of numbers) {
        try {
            await sendMessageWithAttachment(number+"@c.us", message, attachmentPath);
            console.log(`Message sent to ${number}`);
        } catch (error) {
            console.error(`Error sending message to ${number}:`, error);
        }
        const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay; // Generate random delay between minDelay and maxDelay
        await new Promise(resolve => setTimeout(resolve, delay));
    }
}

async function sendMessageWithAttachment(number, message, attachmentPath) {
    try {
        let media = null;
        if (attachmentPath) {
            const ext = attachmentPath.split('.').pop().toLowerCase();
            if (['jpg', 'jpeg', 'png', 'gif'].includes(ext)) {
                media = MessageMedia.fromFilePath(attachmentPath);
            } else {
                const fileData = fs.readFileSync(attachmentPath);
                media = new MessageMedia('application/octet-stream', fileData.toString('base64'), attachmentPath);
            }
        }
        await client.sendMessage(number, message, {
            media: media
        });
        console.log(`Message with attachment sent to ${number} successfully!`);
    } catch (error) {
        console.error(`Error sending message with attachment to ${number}:`, error);
        throw error;
    }
}

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
