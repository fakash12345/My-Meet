const express = require('express');
const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);
const { v4: uuidv4 } = require('uuid');
const { ExpressPeerServer } = require('peer');
const session = require('express-session');

const PORT = process.env.PORT || 3000;

// כאן נשמור בזיכרון מי המנהל של כל חדר
// מבנה: { 'room-id': { hostSessionId: '...', active: true } }
const rooms = {};

const peerServer = ExpressPeerServer(server, { debug: true });

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use('/peerjs', peerServer);

// סשן זמני כדי לזכור את השם של המשתמש במעבר בין דפים
app.use(session({
    secret: 'guest-secret',
    resave: false,
    saveUninitialized: true
}));

// --- Routes ---

// דף הבית (טופס כניסה פשוט)
app.get('/', (req, res) => {
    // אם נכנס עם קישור ספציפי (למשל ?room=123)
    const roomId = req.query.room || uuidv4();
    res.render('index', { roomId });
});

// יצירת שיחה / כניסה לשיחה
app.post('/join', (req, res) => {
    const { name, roomId, action } = req.body;
    
    // שמירת השם והמזהה בסשן
    req.session.userName = name || 'אורח';
    req.session.uid = uuidv4(); // מזהה ייחודי למשתמש הזה

    // אם לחץ על "תזמן למאוחר", רק נראה לו את הקישור
    if (action === 'schedule') {
        return res.render('scheduled', { 
            link: `${req.protocol}://${req.get('host')}/join-link/${roomId}` 
        });
    }

    // אחרת, כניסה מיידית
    res.redirect(`/${roomId}`);
});

// מסלול מיוחד למי שנכנס מקישור חיצוני
app.get('/join-link/:room', (req, res) => {
    res.render('index', { roomId: req.params.room });
});

// חדר הוידאו
app.get('/:room', (req, res) => {
    const roomId = req.params.room;
    
    // אם אין לו שם (נכנס ישירות ל-URL בלי לעבור בדף הבית), נחזיר אותו להתחלה
    if (!req.session.userName) {
        return res.redirect(`/join-link/${roomId}`);
    }

    // --- הלוגיקה של המנהל ---
    // אם החדר לא קיים בזיכרון -> ניצור אותו ונגדיר את המשתמש הנוכחי כמנהל
    if (!rooms[roomId]) {
        rooms[roomId] = {
            hostSessionId: req.session.uid, // המשתמש הזה הוא המנהל!
            createdAt: new Date()
        };
    }

    const isHost = (rooms[roomId].hostSessionId === req.session.uid);

    res.render('room', { 
        roomId, 
        userName: req.session.userName,
        isHost 
    });
});

// --- Socket.io ---
io.on('connection', socket => {
    socket.on('join-room', (roomId, userId) => {
        socket.join(roomId);
        socket.to(roomId).broadcast.emit('user-connected', userId);

        socket.on('disconnect', () => {
            socket.to(roomId).broadcast.emit('user-disconnected', userId);
            
            // בונוס: אם המנהל יצא, אפשר למחוק את החדר (אופציונלי)
            // if (rooms[roomId] && rooms[roomId].hostSessionId === ... ) delete rooms[roomId];
        });
    });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
