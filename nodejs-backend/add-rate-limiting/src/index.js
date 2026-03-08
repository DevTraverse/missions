const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/api/search', (req, res) => {
  res.json({ results: [] });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
