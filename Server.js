const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 5000;
const RAW_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
const RECEIVER_EMAIL = 'naavicedutechprivate@gmail.com';

// Middleware
app.use(cors());
app.use(express.json());

// Build MongoDB URI with database name if omitted after cluster host
function resolveMongoUri(rawUri) {
  if (!rawUri || typeof rawUri !== 'string' || !rawUri.trim()) {
    return null;
  }
  const trimmed = rawUri.trim();
  const [beforeQuery, queryPart] = trimmed.split('?');
  const slashIndexAfterHost = beforeQuery.indexOf('/', beforeQuery.indexOf('@') + 1);

  if (slashIndexAfterHost === -1) {
    return `${beforeQuery}/naavicedutech${queryPart ? `?${queryPart}` : ''}`;
  }

  const afterSlash = beforeQuery.slice(slashIndexAfterHost + 1);
  if (!afterSlash) {
    return `${beforeQuery}naavicedutech${queryPart ? `?${queryPart}` : ''}`;
  }

  return trimmed;
}

const MONGO_URI = resolveMongoUri(RAW_URI);

if (!MONGO_URI) {
  console.error(
    '❌ MONGODB_URI is missing or undefined! Check your .env file at:',
    path.resolve(__dirname, '.env')
  );
  process.exit(1);
}

// MongoDB Connection
mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB - Naavic Edutech Private Limited');
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ MongoDB disconnected.');
});

// Nodemailer Transporter (Gmail App Password)
const hasEmailConfig = Boolean(process.env.EMAIL_PASS && process.env.EMAIL_PASS.trim());
const transporter = hasEmailConfig
  ? nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: (process.env.EMAIL_USER || RECEIVER_EMAIL).trim(),
        pass: process.env.EMAIL_PASS.trim(),
      },
    })
  : null;

async function sendAlertEmail({ subject, text, replyTo, senderLabel }) {
  if (!transporter) {
    console.warn('⚠️ EMAIL_PASS not set in .env — skipping email alert for:', subject);
    return;
  }

  try {
    await transporter.sendMail({
      from: `"${senderLabel || 'Naavic Edutech Website'}" <${
        (process.env.EMAIL_USER || RECEIVER_EMAIL).trim()
      }>`,
      to: RECEIVER_EMAIL,
      ...(replyTo ? { replyTo } : {}),
      subject,
      text,
    });
    console.log('📧 Email alert sent to', RECEIVER_EMAIL);
  } catch (err) {
    console.error('❌ Failed to send email alert:', err.message);
  }
}

// ==================== SCHEMAS & MODELS ====================

// 1. Contact Inquiry Schema & Model
const contactSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true },
    phone: { type: String, default: '', trim: true },
    message: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);
const Contact = mongoose.model('Contact', contactSchema);

// 2. Career Job Application Schema & Model
const applicationSchema = new mongoose.Schema(
  {
    portalName: { type: String, required: true, trim: true },
    jobTitle: { type: String, required: true, trim: true },
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    portfolioOrNote: { type: String, default: '', trim: true },
    status: {
      type: String,
      enum: ['New', 'Reviewed', 'Shortlisted', 'Rejected'],
      default: 'New',
    },
  },
  { timestamps: true }
);
const Application = mongoose.model('Application', applicationSchema);

// 3. Dynamic Job Openings Schema & Model (4 Portals)
const jobSchema = new mongoose.Schema(
  {
    portalId: {
      type: String,
      required: true,
      enum: ['naavic-ho', 'mathbook', 'alphamaster', 'vaagai-study'],
    },
    title: { type: String, required: true, trim: true },
    type: { type: String, default: 'Full-Time', trim: true },
    location: { type: String, default: 'Remote / Hybrid', trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);
const Job = mongoose.model('Job', jobSchema);

// ==================== ROUTES ====================

// Health & DB Status Check
app.get('/', (req, res) => {
  const dbConnected = mongoose.connection.readyState === 1;
  res.json({
    status: 'OK',
    service: 'Naavic Edutech Backend API',
    databaseConnected: dbConnected,
    emailAlertsEnabled: hasEmailConfig,
  });
});

// --- CONTACT ROUTES ---
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, phone, message } = req.body;
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Name, email, and message are required.' });
    }

    const savedContact = await Contact.create({
      name: name.trim(),
      email: email.trim(),
      phone: (phone || '').trim(),
      message: message.trim(),
    });

    await sendAlertEmail({
      senderLabel: 'Naavic Edutech Contact',
      replyTo: email.trim(),
      subject: `New Contact Inquiry: ${name.trim()}`,
      text: [
        `Name: ${name.trim()}`,
        `Email: ${email.trim()}`,
        `Phone: ${(phone || '').trim() || 'Not provided'}`,
        '',
        'Message:',
        message.trim(),
      ].join('\n'),
    });

    res.status(201).json({
      message: 'Contact inquiry submitted successfully.',
      data: savedContact,
    });
  } catch (err) {
    console.error('POST /api/contact error:', err);
    res.status(500).json({ error: 'Failed to submit contact message.' });
  }
});

app.get('/api/contact', async (req, res) => {
  try {
    const messages = await Contact.find().sort({ createdAt: -1 });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch contact messages.' });
  }
});

app.put('/api/contact/:id', async (req, res) => {
  try {
    const updated = await Contact.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!updated) {
      return res.status(404).json({ error: 'Contact message not found.' });
    }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update contact message.' });
  }
});

app.delete('/api/contact/:id', async (req, res) => {
  try {
    const deleted = await Contact.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Contact message not found.' });
    }
    res.json({ message: 'Contact message deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete contact message.' });
  }
});

// --- CAREER APPLICATION ROUTES ---
app.post('/api/careers/apply', async (req, res) => {
  try {
    const { portalName, jobTitle, fullName, email, phone, portfolioOrNote } = req.body;
    if (!portalName || !jobTitle || !fullName || !email || !phone) {
      return res.status(400).json({ error: 'All required fields must be filled.' });
    }

    const savedApplication = await Application.create({
      portalName: portalName.trim(),
      jobTitle: jobTitle.trim(),
      fullName: fullName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      portfolioOrNote: (portfolioOrNote || '').trim(),
    });

    await sendAlertEmail({
      senderLabel: 'Naavic Edutech Careers',
      replyTo: email.trim(),
      subject: `New Job Application: ${jobTitle.trim()} (${portalName.trim()}) - ${fullName.trim()}`,
      text: [
        `Portal: ${portalName.trim()}`,
        `Role: ${jobTitle.trim()}`,
        `Applicant Name: ${fullName.trim()}`,
        `Email: ${email.trim()}`,
        `Phone: ${phone.trim()}`,
        `Note / Link: ${(portfolioOrNote || '').trim() || 'Not provided'}`,
      ].join('\n'),
    });

    res.status(201).json({
      message: 'Application submitted successfully.',
      data: savedApplication,
    });
  } catch (err) {
    console.error('POST /api/careers/apply error:', err);
    res.status(500).json({ error: 'Failed to submit application.' });
  }
});

app.get('/api/careers/applications', async (req, res) => {
  try {
    const applications = await Application.find().sort({ createdAt: -1 });
    res.json(applications);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch applications.' });
  }
});

app.patch('/api/careers/applications/:id/status', async (req, res) => {
  try {
    const { status, portfolioOrNote } = req.body;
    const updatePayload = {};
    if (status) updatePayload.status = status;
    if (portfolioOrNote !== undefined) updatePayload.portfolioOrNote = portfolioOrNote;

    const updated = await Application.findByIdAndUpdate(
      req.params.id,
      updatePayload,
      { new: true, runValidators: true }
    );
    if (!updated) {
      return res.status(404).json({ error: 'Application not found.' });
    }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update application.' });
  }
});

app.delete('/api/careers/applications/:id', async (req, res) => {
  try {
    const deleted = await Application.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Application not found.' });
    }
    res.json({ message: 'Application deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete application.' });
  }
});

// --- JOB OPENINGS ROUTES (4 Portals) ---
app.get('/api/jobs', async (req, res) => {
  try {
    const jobs = await Job.find({ isActive: true }).sort({ createdAt: -1 });
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch jobs.' });
  }
});

app.post('/api/jobs', async (req, res) => {
  try {
    const { portalId, title, type, location } = req.body;
    if (!portalId || !title) {
      return res.status(400).json({ error: 'Portal and job title are required.' });
    }
    const newJob = await Job.create({
      portalId: portalId.trim(),
      title: title.trim(),
      type: (type || 'Full-Time').trim(),
      location: (location || 'Remote / Hybrid').trim(),
    });
    res.status(201).json(newJob);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create job opening.' });
  }
});

app.put('/api/jobs/:id', async (req, res) => {
  try {
    const updated = await Job.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!updated) {
      return res.status(404).json({ error: 'Job opening not found.' });
    }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update job opening.' });
  }
});

app.delete('/api/jobs/:id', async (req, res) => {
  try {
    const deleted = await Job.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Job opening not found.' });
    }
    res.json({ message: 'Job opening deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete job opening.' });
  }
});

// Global Error Fallback
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});