const mongoose = require('mongoose');

// חיבור למסד הנתונים (תומך גם מקומית וגם בענן)
const dbURI = process.env.MONGO_URI || 'mongodb://localhost:27017/mymeet';

mongoose.connect(dbURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log("✅ Connected to MongoDB"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

// סכמה למשתמשים
const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    name: { type: String, default: 'User' },
    createdAt: { type: Date, default: Date.now }
});

// סכמה להגדרות מערכת (ניהול)
const systemSchema = new mongoose.Schema({
    allowRegistration: { type: Boolean, default: true },
    allowNewMeetings: { type: Boolean, default: true }
});

// סכמה לפגישות פעילות
const meetingSchema = new mongoose.Schema({
    roomId: String,
    hostEmail: String,
    startTime: { type: Date, default: Date.now },
    active: { type: Boolean, default: true }
});

module.exports = {
    User: mongoose.model('User', userSchema),
    System: mongoose.model('System', systemSchema),
    Meeting: mongoose.model('Meeting', meetingSchema)
};
