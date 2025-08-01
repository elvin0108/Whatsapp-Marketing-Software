const express = require('express');
const { engine } = require('express-handlebars');
const { Client, RemoteAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const multer = require('multer');
const path = require('path');
const bodyParser = require('body-parser');
const fs = require('fs');
const ExcelJS = require('exceljs');
const qr = require('qrcode');
const passport = require('passport');
const session = require('express-session');
const crypto = require('crypto');
const mongoose = require('mongoose');
require('dotenv').config();
const User = require('./models/user');
const { Server } = require('socket.io');
const http = require('http');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const {MongoStore} = require('wwebjs-mongo');
const port = 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: 'secret', resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());

// Set up Handlebars view engine
app.engine('handlebars', engine({ defaultLayout: 'main' }));
app.set('view engine', 'handlebars');
app.use(express.static('public'));

const clients = {}; // Store clients with user tokens
let store;

mongoose.connect("mongodb+srv://elvinkhunt:elvinkhunt@cluster0.byrb8sh.mongodb.net/user_registration")
.then(()=>{
    store = new MongoStore({ mongoose: mongoose });
    console.log("Mongo Connected Successfully");
})
.catch((err)=>{
    console.log("Failed to Connect",err);
});

const users = {
    "id1": { username: "elvin-khunt", password: "password123", token: "elvin1234khunt01082002sanathali5678" }, // "password123"
    "id2": { username: "hitesh-dhaduk", password: "mypassword" }, // "mypassword"
    "id3": { username: "mukesh-khunt", password: "secret" } // "secret"
};

const authenticate = async (req, res, next) => {
    const { username, password } = req.body;
    const userDoc = await User.findOne({ username: username });
    if (!userDoc || userDoc.password !== password) {
        return res.status(400).json({ message: "Authentication failed" });
    }
    next();
};

const generateAlphanumericToken = (length) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < length; i++) {
        const randomIndex = crypto.randomInt(0, chars.length);
        token += chars[randomIndex];
    }
    return token;
};

app.get('/elvin/register', (req, res) => {
    res.render('register');
});

app.post('/register', async (req, res) => {
    let { admin, username, password, cnfPassword, licenceKey } = req.body;
    try {
        if (admin === process.env.admin) {
            if (password === cnfPassword) {
                const existingUser = await User.findOne({ username: username });
                if (existingUser) {
                    return res.status(400).json({ message: "User already exists!" });
                } else {
                    const userDoc = await User.create({ username, password, token: licenceKey });
                    console.log("New user created on " + new Date() + " : " + userDoc);
                    res.status(200).json({ message: "User Registered Successfully!" });
                }
            } else {
                res.status(400).json({ message: "Passwords do not match" });
            }
        } else {
            res.status(400).json({ message: "Invalid Admin" });
        }
    } catch (e) {
        res.status(400).json(e);
    }
});

app.post('/login', authenticate, async (req, res) => {
    const username = req.body.username;
    const userDoc = await User.findOne({ username: username });
    const token = userDoc.token;
    req.session.token = token;

    if (!clients[token]) {
        clients[token] = { isReady: false, qrCode: null, client: null }; // Initialize client data
        initializeClient(token);
    }
    res.json({ token });
});

const authenticateToken = (req, res, next) => {
    const token = req.session.token;
    if (!token || !clients[token]) {
        return res.sendStatus(401);
    }
    req.token = token;
    next();
};

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('check-client-status', async (token) => {
        const clientData = clients[token] || {};
        const ready = clientData.isReady || false;
        const qr = !!clientData.qrCode;
        const qrData = clientData.qrCode;
        socket.emit('client-status', { ready, qr, qrData });
    });

    socket.on('disconnect', () => {
        console.log('A user disconnected:', socket.id);
    });
});

const initializeClient = (token) => {

    const client = new Client({
        authStrategy: new RemoteAuth({
            store: store,
            clientId: token,
            backupSyncIntervalMs: 300000
        }),
        webVersionCache: {
            type: 'remote',
            remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
        },
    });

    clients[token].client = client;

    client.initialize();

    client.on('ready', () => {
        console.log('Client is ready!');
        clients[token].isReady = true;
        io.emit('client-status-update', { token, ready: true });
    });

    client.on('qr', (qrCode) => {
        clients[token].qrCode = qrCode;
        console.log('QR code is ready!');
        io.emit('client-status-update', { token, qr: true, qrData: qrCode });
    });

    client.on('message', async (msg) => {
        if (msg.body === 'ping') {
            await msg.reply('pong');
        }
    });
};

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

app.get('/', (req, res) => {
    res.render('form');
});

app.get('/client-status', authenticateToken, (req, res) => {
    const token = req.token;
    const clientData = clients[token] || {};
    res.json({ ready: clientData.isReady, qr: !!clientData.qrCode, qrData: clientData.qrCode });
});

app.post('/qrcode', authenticateToken, async (req, res) => {
    const textData = req.body.data || 'Hello, world!';
    try {
        const qrSvgString = await qr.toString(textData, { type: 'svg' });
        const base64Data = Buffer.from(qrSvgString).toString('base64');
        res.json({ imgData: base64Data });
    } catch (error) {
        console.error('Error generating QR code:', error);
        res.status(500).json({ error: 'Failed to generate QR code' });
    }
});

app.post('/send-message', [authenticateToken, upload.fields([{ name: 'attachment', maxCount: 1 }, { name: 'attachment-excel', maxCount: 1 }])], async (req, res) => {
    const { message, minDelay, maxDelay, manualInput } = req.body;
    const attachmentPath = req.files['attachment'] ? req.files['attachment'][0].path : null;
    const excelPath = req.files['attachment-excel'] ? req.files['attachment-excel'][0].path : null;
    const token = req.token;
    const client = clients[token].client;

    if (!message) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    if (minDelay === undefined || maxDelay === undefined) {
        return res.status(400).json({ error: 'Missing delay configuration' });
    }

    try {
        let numbers = "";
        if (excelPath) {
            numbers = await readNumbersFromExcel(excelPath);
        } else {
            numbers = manualInput.split(",");
        }
        await sendMessagesWithDelay(client, numbers, message, attachmentPath, minDelay, maxDelay);
        res.render('back');
    } catch (error) {
        console.error('Error sending messages:', error);
        res.status(500).json({ error: 'Failed to send messages' });
    }
});

app.get('/save-contacts', authenticateToken, async (req, res) => {
    const token = req.token;
    const client = clients[token].client;
    try {
        const contacts = await client.getContacts();
        const savedContacts = contacts.filter(contact => !contact.isGroup).map(contact => ({
            name: contact.name,
            phoneNumber: contact.id.user
        }));

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Contacts');
        worksheet.columns = [{ header: 'Number', key: 'phoneNumber' }, { header: 'Name', key: 'name' }];
        savedContacts.forEach(contact => worksheet.addRow(contact));

        const buffer = await workbook.xlsx.writeBuffer();
        res.set({
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': 'attachment; filename=contacts.xlsx',
            'Content-Length': buffer.length
        });
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

async function sendMessagesWithDelay(client, numbers, message, attachmentPath, minDelay, maxDelay) {
    let messageCount = 0;
    for (const number of numbers) {
        try {
            await sendMessageWithAttachment(client, number + "@c.us", message, attachmentPath);
            console.log(`Message sent to ${number} ${++messageCount}`);
        } catch (error) {
            console.error(`Error sending message to ${number}:`, error);
        }
        const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + parseInt(minDelay);
        await new Promise(resolve => setTimeout(resolve, delay * 1000));
    }
}

async function sendMessageWithAttachment(client, number, message, attachmentPath) {
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
        await client.sendMessage(number, message, { media });
        console.log(`Message with attachment sent to ${number} successfully!`);
    } catch (error) {
        console.error(`Error sending message with attachment to ${number}:`, error);
        throw error;
    }
}

server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
