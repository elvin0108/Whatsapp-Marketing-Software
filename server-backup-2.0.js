const express = require('express');
const {engine}  = require('express-handlebars');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const multer  = require('multer');
const path = require('path');
const bodyParser = require('body-parser');
const fs = require('fs');
const ExcelJS = require('exceljs');
const qr = require('qrcode');

const app = express();
const port = 3000;

app.use(bodyParser.json());

// Set up Handlebars view engine
app.engine('handlebars', engine({ defaultLayout: 'main' }));
app.set('view engine', 'handlebars');
app.use(express.static('public'));

let isClientReady = false;
let isQRGenerated = false;

// const client = new Client({
//     authStrategy: new LocalAuth(),
//     puppeteer: { headless: true, args: ['--no-sandbox', '--disable-gpu'] },
//     webVersionCache: {
//         type: 'remote',
//         remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3090.1.html',
//     }
// });
const client = new Client({
    authStrategy: new LocalAuth(),
    webVersionCache: {
      type: "remote",
      remotePath:
        "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html",
    },
  });

client.initialize();

client.on('message', async (msg) => {
    if (msg.body === 'ping') {
        await msg.reply('pong');
    }
});

// Set up multer for file upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

client.on('ready', async () => {
    console.log('Client is ready!');
    isClientReady = true;
});

let QRCode = "";
client.on('qr', qr => {
    //qrcode.generate(qr, { small: true });
    isQRGenerated = true;
    QRCode = qr;
});

// Route to render the form
app.get('/', (req, res) => {
    res.render('form');
});

app.get('/client-status', (req, res) => {
    res.json({ ready: isClientReady, qr: isQRGenerated, qrData: QRCode });
});

app.post('/qrcode', async (req, res) => {
    const textData = req.body.data || 'Hello, world!'; // Text to encode into QR code
    try {
        // Generate QR code as SVG string
        const qrSvgString = await qr.toString(textData, { type: 'svg' });

        // Convert SVG string to base64
        const base64Data = Buffer.from(qrSvgString).toString('base64');
        
        res.json({imgData:base64Data});
    } catch (error) {
        console.error('Error generating QR code:', error);
        throw error;
    }
});

// Route to handle form submission
app.post('/send-message', upload.fields([{ name: 'attachment', maxCount: 1 }, { name: 'attachment-excel', maxCount: 1 }]), async (req, res) => {
    const { message, minDelay, maxDelay, manualInput } = req.body;
    const attachmentPath = req.files['attachment'] ? req.files['attachment'][0].path : null;
    const excelPath = req.files['attachment-excel'] ? req.files['attachment-excel'][0].path : null;

    if (!message) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    if (minDelay === undefined || maxDelay === undefined) {
        return res.status(400).json({ error: 'Missing delay configuration' });
    }

    try {
        let numbers = "";
        if (excelPath) {
            numbers = await readNumbersFromExcel(excelPath); // Pass the excelPath to readNumbersFromExcel function
        } else {
            numbers = manualInput.split(",");
        }
        await sendMessagesWithDelay(numbers, message, attachmentPath, minDelay, maxDelay);
        // res.status(200).json({ message: 'Messages sent successfully' });
        res.render('back');
    } catch (error) {
        console.error('Error sending messages:', error);
        res.status(500).json({ error: 'Failed to send messages' });
    }
});

app.get('/save-contacts', async (req, res) => {
    try {

        const contacts = await client.getContacts();

        const savedContacts = [];
        const groupContacts = [];

        const chats = await client.getChats();

        chats.forEach(chat => {
            console.log(`Chat: ${chat.name} - ID: ${chat.id._serialized}`);
        });

        const groupId = '919913444123-1532185949@g.us';

        try {
            const chat = await client.getChatById(groupId);

            if (chat.isGroup) {
                const participants = chat.participants;

                participants.forEach(participant => {
                    console.log(`Participant: ${participant.id._serialized}`);
                });
            } else {
                console.log('This is not a group chat');
            }
        } catch (error) {
            console.error('Error getting group chat:', error);
        }

        contacts.forEach(contact => {
            if (contact.isGroup) {
                groupContacts.push({
                    name: contact.name,
                    phoneNumber: contact.id.user
                });
            } else {
                savedContacts.push({
                    name: contact.name,
                    phoneNumber: contact.id.user
                });
            }
        });

        //console.log(phoneNumbers);
        // Create a new workbook
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Contacts');

        // Add column headers
        worksheet.columns = [{ header: 'Number', key: 'phoneNumber' }, { header: 'Name', key: 'name' }];

        // Add data
        savedContacts.forEach(contact => {
            worksheet.addRow({ phoneNumber: contact.phoneNumber, name: contact.name });
        });

        // Generate a buffer with the Excel data
        const buffer = await workbook.xlsx.writeBuffer();

        // Set the appropriate headers for file download
        res.set({
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': 'attachment; filename=contacts.xlsx',
            'Content-Length': buffer.length
        });

        // Send the buffer as the response
        res.send(buffer);
    } catch (error) {
        console.error('Error generating Excel file:', error);
        res.status(500).send('Internal Server Error');
    }
});

async function readNumbersFromExcel(filePath) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
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
        const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + parseInt(minDelay); // Generate random delay between minDelay and maxDelay
        await new Promise(resolve => setTimeout(resolve, delay*1000));
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
