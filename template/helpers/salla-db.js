// Shared SallaDatabase singleton so app.js and webhook action files
// use the same connection instance.
const SallaDatabase = require("../database")(
  process.env.SALLA_DATABASE_ORM || "Sequelize"
);
module.exports = SallaDatabase;
