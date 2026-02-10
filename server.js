const express = require('express');
const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);
const { v4: uuidv4 } = require('uuid');
const { ExpressPeerServer } = require('peer');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { User, System, Meeting } = require('./database');

// הגדרת פורט (חשוב ל-Render)
const PORT = process.env.PORT || 3000;

// הגדרת שרת PeerJS לוידאו
const peerServer = ExpressPeerServer(server, { debug: true });

app.set('view engine', 'ejs');
app.use(express.static('public')); // עבור קבצים סטטיים אם תוסיף בעתיד
app.use(express.urlencoded({ extended: true }));
app.use('/peerjs', peerServer); // נתיב לוידאו

// ניהול Session
app.use(session({
    secret: 'mysecretkey123', // בייצור כדאי לשים ב-ENV
    resave: false,
    saveUninitialized: true
}));

// --- Middleware ---
const requireAuth = (req, res, next) => {
    if (!req.session.userId) return res.redirect('/');
    next();
};

const requireAdmin = (req, res, next) => {
    if (!req.session.isAdmin) return res.redirect('/dashboard');
    next();
};

// אתחול הגדרות מערכת
(async () => {
    try {
        const sys = await System.findOne();
        if (!sys) await new System().save();
    } catch (e) { console.log("System init error", e); }
})();

// --- Routes ---

// דף הבית / התחברות
app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/dashboard');
    res.render('index', { error: null });
});

// לוגין
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    // כניסת מנהל (Hardcoded)
    if (email === 'yairfrish2@gmail.com' && password === 'prha12345') {
        req.session.userId = 'admin';
        req.session.isAdmin = true;
        req.session.email = email;
        req.session.name = 'מנהל ראשי';
        return res.redirect('/admin');
    }

    try {
        const user = await User.findOne({ email });
        if (!user || !bcrypt.compareSync(password, user.password)) {
            return res.render('index', { error: 'אימייל או סיסמה שגויים' });
        }

        req.session.userId = user._id;
        req.session.email = user.email;
        req.session.name = user.name;
        req.session.isAdmin = false;
        res.redirect('/dashboard');
    } catch (e) { res.send("Error"); }
});

// הרשמה
app.post('/register', async (req, res) => {
    try {
        const sys = await System.findOne();
        if (sys && !sys.allowRegistration) return res.render('index', { error: 'ההרשמה למערכת חסומה כעת.' });

        const { email, password, name } = req.body;
        if (await User.findOne({ email })) return res.render('index', { error: 'המייל כבר קיים במערכת' });

        const hashedPassword = bcrypt.hashSync(password, 10);
        await new User({ email, password: hashedPassword, name }).save();
        
        res.render('index', { error: 'ההרשמה הצליחה! אנא התחבר.' });
    } catch (e) { res.redirect('/'); }
});

// דאשבורד
app.get('/dashboard', requireAuth, async (req, res) => {
    let user;
    if (req.session.isAdmin) {
        user = { name: 'Admin', email: req.session.email };
    } else {
        user = await User.findById(req.session.userId);
    }
    if(!user) { req.session.destroy(); return res.redirect('/'); }
    
    res.render('dashboard', { user });
});

// עדכון פרופיל
app.post('/update-profile', requireAuth, async (req, res) => {
    if (req.session.isAdmin) return res.redirect('/dashboard');
    
    const { email, password, name } = req.body;
    const updateData = { email, name };
    if (password && password.trim() !== "") {
        updateData.password = bcrypt.hashSync(password, 10);
    }
    
    await User.findByIdAndUpdate(req.session.userId, updateData);
    req.session.email = email;
    req.session.name = name;
    res.redirect('/dashboard');
});

// מחיקת חשבון
app.post('/delete-account', requireAuth, async (req, res) => {
    if (req.session.isAdmin) return res.send("לא ניתן למחוק את חשבון המנהל הראשי");
    await User.findByIdAndDelete(req.session.userId);
    req.session.destroy();
    res.redirect('/');
});

// יצירת פגישה
app.get('/create-meeting', requireAuth, async (req, res) => {
    const sys = await System.findOne();
    if (sys && !sys.allowNewMeetings && !req.session.isAdmin) {
        return res.send("יצירת פגישות חסומה כעת על ידי המנהל.");
    }
    
    const roomId = uuidv4();
    await new Meeting({ roomId, hostEmail: req.session.email }).save();
    res.redirect(`/${roomId}`);
});

// התנתקות
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- אזור ניהול (Admin) ---
app.get('/admin', requireAdmin, async (req, res) => {
    const sys = await System.findOne() || new System();
    const search = req.query.search || '';
    
    let users = [];
    if (search) {
        users = await User.find({ email: { $regex: search, $options: 'i' } });
    } else {
        users = await User.find({}).limit(50); // מגביל ל-50 כדי לא להעמיס
    }
    
    const activeMeetings = await Meeting.find({ active: true });
    res.render('admin', { sys, users, meetings: activeMeetings, search });
});

app.post('/admin/toggle-reg', requireAdmin, async (req, res) => {
    const sys = await System.findOne();
    sys.allowRegistration = !sys.allowRegistration;
    await sys.save();
    res.redirect('/admin');
});

app.post('/admin/toggle-meet', requireAdmin, async (req, res) => {
    const sys = await System.findOne();
    sys.allowNewMeetings = !sys.allowNewMeetings;
    await sys.save();
    res.redirect('/admin');
});

app.post('/admin/delete-user', requireAdmin, async (req, res) => {
    await User.findByIdAndDelete(req.body.userId);
    res.redirect('/admin');
});

app.post('/admin/close-meeting', requireAdmin, async (req, res) => {
    const { roomId } = req.body;
    await Meeting.findOneAndUpdate({ roomId }, { active: false });
    io.to(roomId).emit('admin-closed-room');
    res.redirect('/admin');
});

// --- חדר הווידאו ---
app.get('/:room', requireAuth, async (req, res) => {
    // ניתן להוסיף כאן בדיקה אם הפגישה קיימת ב-DB
    // כרגע נאפשר כניסה לכל חדר כדי למנוע באגים, אבל נסמן מי המנהל
    const meeting = await Meeting.findOne({ roomId: req.params.room });
    
    const isHost = meeting ? (req.session.email === meeting.hostEmail || req.session.isAdmin) : true;

    res.render('room', { 
        roomId: req.params.room, 
        userEmail: req.session.email,
        isHost: isHost
    });
});

// --- Socket.io ---
io.on('connection', socket => {
    socket.on('join-room', (roomId, userId) => {
        socket.join(roomId);
        socket.to(roomId).broadcast.emit('user-connected', userId);

        socket.on('disconnect', () => {
            socket.to(roomId).broadcast.emit('user-disconnected', userId);
        });
    });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
