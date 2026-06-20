const dns = require("node:dns");
dns.setServers(["1.1.1.1", "1.0.0.1"]);

const express = require("express");
const dontenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
dontenv.config();

const uri = process.env.MONGO_URI;

const app = express();
const PORT = process.env.PORT;

// app.use(
//   cors({
//     credentials: true,
//     origin: [process.env.CLIENT_URI],
//   }),
// );

app.use(cors());
app.use(express.json());

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const recipeHubDB = client.db("recipe-hub");
    const recipesCollection = recipeHubDB.collection("recipes");

    app.post("/api/recipes", async (req, res) => {
      const result = await recipesCollection.insertOne(req.body);
      res
        .status(201)
        .json({
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
