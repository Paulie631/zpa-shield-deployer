require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use('/api/zpa', require('./routes/zpa'));
app.use('/api/aws', require('./routes/aws'));
app.use('/api/cloudshare', require('./routes/cloudshare'));
app.use('/api/testapps', require('./routes/testapps'));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`ZPA Shield Deployer backend running on http://localhost:${PORT}`));
