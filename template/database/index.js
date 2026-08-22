///

class SallaDatabase {
  constructor(DATABASE_ORM) {
    this.Database = require("../helpers/ORMs/" + DATABASE_ORM);
    this.DATABASE_ORM = DATABASE_ORM;
  }
  async connect() {
    try {
      this.connection = this.connection  || await this.Database.connect();
      return this.connection;
    } catch (err) {
      console.log("Error connecting to database: ", err);
      return null;
    }
  }
  async retrieveUser(data,includeRelatedData) {
    if (this.DATABASE_ORM == "TypeORM") {
      var userRepository = this.connection.getRepository("User");
      userRepository
    }
    if (this.DATABASE_ORM == "Sequelize") {
      return await this.connection.models.User.findOne({
        where: { ...data },
        include: includeRelatedData ? this.connection.models.OauthTokens : undefined,
      })
    }
    if (this.DATABASE_ORM == "Mongoose") {
    return includeRelatedData ?
      await this.connection.Mongoose.models.User.findOne(data).populate({
        path: 'oauthId',
        select: 'access_token' 
    }):
      await this.connection.Mongoose.models.User.findOne(data) 

    }

  }
    async saveUser(data) {
    if (this.DATABASE_ORM == "TypeORM") {
      var userRepository = this.connection.getRepository("User");
      userRepository
        .save(data)
        .then(function (savedUser) {
          console.log("User has been saved: ", savedUser);
          console.log("Now lets load all users: ");

          return userRepository.find();
        })
        .then(function (users) {
          console.log("All users: ", users);
        });
    }
    if (this.DATABASE_ORM == "Sequelize") {
      let user = await this.connection.models.User.findOne({
        where: { email: data.email },
      });
      if (!user) {
        user = await this.connection.models.User.create(data);
      }
      return user.id;
    }
    if (this.DATABASE_ORM == "Mongoose") {
      let userObj
      try {
        userObj =  await this.connection.Mongoose.models.User.findOneAndUpdate(
          { email:data.email },
           data ,
          { upsert: true, new: true }
        )
        console.log("user has been created")
        return userObj._id;
      } catch (err) { 
         
      }
    }
  }
  async saveOauth({user_id, ...data }) {
    if (this.DATABASE_ORM == "Sequelize") {
      const user = await this.connection.models.User.findOne({
        where: { id: user_id },
      });
      if (user) {
        let token = await this.connection.models.OauthTokens.findOne({
          where: { user_id },
        });
        if (token) {
          await token.update(data);
        } else {
          await this.connection.models.OauthTokens.create({
            user_id: user_id,
            ...data,
          });
        }
      }
    }
    if (this.DATABASE_ORM == "Mongoose") {
      try {
      return this.connection.Mongoose.models.oAuthToken.findOneAndUpdate(
          { user: user_id },
          { user: user_id, ...data },
          { upsert: true, new: true }
          ).then(async results => {
            await this.connection.Mongoose.models.User.findOneAndUpdate(
              { _id: user_id },
              { $set: {
                oauthId: results._id
              } },
              {  new: true }
            )
            return results
          });
      } catch (err) {
      }
    }
  }
  async ensureConnection() {
    if (!this.connection) await this.connect();
    if (!this.connection) throw new Error("Database connection failed");
    return this.connection;
  }
  async saveAbandonedCart(data) {
    const db = await this.ensureConnection();
    if (this.DATABASE_ORM == "Sequelize") {
      let row = await db.models.AbandonedCarts.findOne({
        where: { merchant: data.merchant, cart_id: data.cart_id },
      });
      if (row) {
        await row.update(data);
        return row.id;
      }
      row = await db.models.AbandonedCarts.create({ ...data, status: "new" });
      return row.id;
    }
  }
  async listAbandonedCarts(merchant) {
    const db = await this.ensureConnection();
    if (this.DATABASE_ORM == "Sequelize") {
      return await db.models.AbandonedCarts.findAll({
        where: merchant ? { merchant } : {},
        order: [["id", "DESC"]],
        limit: 200,
      });
    }
    return [];
  }
  async setAbandonedCartStatus(merchant, cart_id, status) {
    const db = await this.ensureConnection();
    if (this.DATABASE_ORM == "Sequelize") {
      const row = await db.models.AbandonedCarts.findOne({
        where: { merchant, cart_id },
      });
      if (!row) return;
      const update = { status };
      if (status == "contacted") update.last_contacted_at = Math.floor(Date.now() / 1000);
      await row.update(update);
    }
  }
  async getMerchantSettings(merchant) {
    const db = await this.ensureConnection();
    if (this.DATABASE_ORM == "Sequelize") {
      return await db.models.MerchantSettings.findOne({ where: { merchant } });
    }
    return null;
  }
  async saveMerchantSettings(merchant, data) {
    const db = await this.ensureConnection();
    if (this.DATABASE_ORM == "Sequelize") {
      let row = await db.models.MerchantSettings.findOne({ where: { merchant } });
      if (row) {
        await row.update(data);
        return row;
      }
      return await db.models.MerchantSettings.create({ merchant, ...data });
    }
    return null;
  }
  async getAllMerchantIds() {
    const db = await this.ensureConnection();
    if (this.DATABASE_ORM == "Sequelize") {
      const rows = await db.models.AbandonedCarts.findAll({
        attributes: ["merchant"],
        group: ["merchant"],
        raw: true,
      });
      return rows.map((r) => r.merchant);
    }
    return [];
  }
  async saveManualCustomer(data) {
    const db = await this.ensureConnection();
    if (this.DATABASE_ORM == "Sequelize") {
      return await db.models.ManualCustomers.create({
        ...data,
        created_at: Math.floor(Date.now() / 1000),
      });
    }
    return null;
  }
  async listManualCustomers(merchant) {
    const db = await this.ensureConnection();
    if (this.DATABASE_ORM == "Sequelize") {
      return await db.models.ManualCustomers.findAll({
        where: { merchant },
        order: [["id", "DESC"]],
      });
    }
    return [];
  }
  async deleteManualCustomer(merchant, id) {
    const db = await this.ensureConnection();
    if (this.DATABASE_ORM == "Sequelize") {
      const row = await db.models.ManualCustomers.findOne({ where: { merchant, id } });
      if (row) await row.destroy();
    }
  }

  // ===================== Automation Hub =====================
  async saveAutomation(merchant, key, data) {
    const db = await this.ensureConnection();
    if (this.DATABASE_ORM == "Sequelize") {
      let row = await db.models.Automations.findOne({ where: { merchant, key } });
      if (row) {
        await row.update(data);
        return row;
      }
      return await db.models.Automations.create({ merchant, key, ...data });
    }
    return null;
  }
  async getAutomations(merchant) {
    const db = await this.ensureConnection();
    if (this.DATABASE_ORM == "Sequelize") {
      return await db.models.Automations.findAll({ where: { merchant } });
    }
    return [];
  }
  async insertMessage(data) {
    const db = await this.ensureConnection();
    if (this.DATABASE_ORM == "Sequelize") {
      return await db.models.Messages.create({
        attempts: 0,
        status: "pending",
        created_at: Math.floor(Date.now() / 1000),
        ...data,
      });
    }
    return null;
  }
  async listMessages(merchant, limit = 40) {
    const db = await this.ensureConnection();
    if (this.DATABASE_ORM == "Sequelize") {
      return await db.models.Messages.findAll({
        where: { merchant },
        order: [["id", "DESC"]],
        limit,
      });
    }
    return [];
  }
  async listDueMessages(limit = 50) {
    const db = await this.ensureConnection();
    if (this.DATABASE_ORM == "Sequelize") {
      return await db.models.Messages.findAll({
        where: {
          status: "pending",
          scheduled_at: { [db.Sequelize.Op.lte]: Math.floor(Date.now() / 1000) },
          attempts: { [db.Sequelize.Op.lt]: 3 },
        },
        order: [["scheduled_at", "ASC"]],
        limit,
      });
    }
    return [];
  }
  async markMessageSent(id, channel) {
    const db = await this.ensureConnection();
    if (this.DATABASE_ORM == "Sequelize") {
      const row = await db.models.Messages.findOne({ where: { id } });
      if (row)
        await row.update({
          status: "sent",
          channel,
          sent_at: Math.floor(Date.now() / 1000),
          error: null,
        });
    }
  }
  async bumpMessageAttempt(id, error) {
    const db = await this.ensureConnection();
    if (this.DATABASE_ORM == "Sequelize") {
      const row = await db.models.Messages.findOne({ where: { id } });
      if (!row) return;
      const attempts = (row.attempts || 0) + 1;
      await row.update({
        attempts,
        error,
        status: attempts >= 3 ? "failed" : "pending",
      });
    }
  }
  async cancelPendingForOrder(merchant, order_id, kinds = null) {
    const db = await this.ensureConnection();
    if (this.DATABASE_ORM == "Sequelize") {
      const where = { merchant, order_id, status: "pending" };
      if (kinds) where.kind = kinds;
      const rows = await db.models.Messages.findAll({ where });
      for (const r of rows) await r.update({ status: "cancelled" });
      return rows.length;
    }
    return 0;
  }
  async hasMessageForOrder(merchant, kind, order_id) {
    const db = await this.ensureConnection();
    if (this.DATABASE_ORM == "Sequelize") {
      const n = await db.models.Messages.count({
        where: {
          merchant,
          kind,
          order_id,
          status: { [db.Sequelize.Op.in]: ["pending", "sent"] },
        },
      });
      return n > 0;
    }
    return false;
  }
  async messageStats(merchant) {
    const db = await this.ensureConnection();
    if (this.DATABASE_ORM == "Sequelize") {
      const dayAgo = Math.floor(Date.now() / 1000) - 86400;
      const count = (where) => db.models.Messages.count({ where: { merchant, ...where } });
      return {
        pending: await count({ status: "pending" }),
        sentToday: await count({ status: "sent", sent_at: { [db.Sequelize.Op.gte]: dayAgo } }),
        sentTotal: await count({ status: "sent" }),
        failed: await count({ status: "failed" }),
      };
    }
    return { pending: 0, sentToday: 0, sentTotal: 0, failed: 0 };
  }
}
module.exports = (DATABASE_ORM) => new SallaDatabase(DATABASE_ORM);
