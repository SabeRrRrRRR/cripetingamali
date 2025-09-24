const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors({ origin: '*' })); // Allow all origins for testing
app.use(express.json());

app.get('/api/hello', (req, res) => {
  res.json({ message: 'Hello from Render!', time: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port', PORT));
