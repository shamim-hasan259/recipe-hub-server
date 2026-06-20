const dns = require("node:dns");
dns.setServers(["1.1.1.1", "1.0.0.1"]);

const express = require("express");
const dontenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");
dontenv.config();

const uri = process.env.MONGO_URI;

const app = express();
const PORT = process.env.PORT;

app.use(
  cors({
    credentials: true,
    origin: [process.env.CLIENT_URI],
  }),
);

app.use(cors());
app.use(express.json());

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URI}/api/auth/jwks`),
);
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer")) {
    return res.status(401).json({ msg: "Unauthorized" });
  }
  const token = authHeader.split(" ")[1];
  // console.log(token);

  if (!token) {
    return res.status(401).json({ msg: "Unauthorized" });
  }
  try {
    const { payload } = await jwtVerify(token, JWKS);
    req.user = payload;
    next();
  } catch (error) {
    console.log(error);
    return res.status(401).json({ msg: "Unauthorized" });
  }
};

const verifyUser = (req, res, next) => {
  if (req.user.role !== "user") {
    return res.status(403).json({ status: false, message: "Forbidden" });
  }
  next();
};

const verifyAdmin = (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ status: false, message: "Forbidden" });
  }
  next();
};
async function run() {
  try {
    await client.connect();
    const recipeHubDB = client.db("recipe-hub");
    const recipesCollection = recipeHubDB.collection("recipes");
    const userCollection = recipeHubDB.collection("user");

    // user related api

    app.patch("/api/user/:id", async (req, res) => {
      const { id } = req.params;

      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $inc: {
            limit: 1,
          },
        },
      );

      res.status(200).json({
        success: true,
        message: "Limit increased successfully",
        data: result,
      });
    });

    // public api
    app.get("/api/allrecipes", async (req, res) => {});

    app.post("/api/recipes", verifyToken, verifyUser, async (req, res) => {
      const body = req.body;
      const data = {
        ...body,
        createdAt: new Date(),
      };
      const result = await recipesCollection.insertOne(data);
      res.status(201).json({
        status: true,
        message: "recipe created successfully",
        data: result,
      });
    });
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
