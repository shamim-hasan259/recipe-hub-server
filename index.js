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
  console.log(token);

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
    const usersCollection = recipeHubDB.collection("user");
    const subscriptionsCollection = recipeHubDB.collection("subscriptions");
    const reportCollection = recipeHubDB.collection("reports");
    const favouritesCollectio = recipeHubDB.collection("favourites");
    const paymentCollection = recipeHubDB.collection("payments");
    // subscription related api
    app.post(
      "/api/subscriptions",
      verifyToken,
      verifyUser,
      async (req, res) => {
        const { sessionId, userId, priceId } = req.body;
        const exist = await subscriptionsCollection.findOne({ userId });
        if (exist) {
          return res.json({ message: "Already Exsist" });
        }

        const subucriptionData = await subscriptionsCollection.insertOne({
          sessionId,
          userId,
          priceId,
          createdAt: new Date(),
        });

        await usersCollection.updateOne(
          { _id: new ObjectId(userId) },
          {
            $set: {
              plan: "premium",
            },
          },
        );
      },
    );

    // payment related api

    app.post("/api/payments", verifyToken, verifyUser, async (req, res) => {
      const data = req.body;
      const paymentsData = {
        ...data,
        createdAt: new Date(),
      };
      const result = await paymentCollection.insertOne(paymentsData);
      res.status(201).json({ status: true, message: "payments successfully" });
    });

    app.get("/api/getpayments", verifyToken, verifyUser, async (req, res) => {
      const result = await paymentCollection.find().toArray();
      res
        .status(200)
        .json({
          status: true,
          message: "payments data fecteched successfully",
          data: result,
        });
    });

    // // user related api
    // app.patch("/api/user/:id", verifyToken, verifyUser, async (req, res) => {
    //   const { id } = req.params;
    //   const result = await usersCollection.updateOne(
    //     { _id: new ObjectId(id) },
    //     {
    //       $inc: {
    //         limit: 1,
    //       },
    //     },
    //   );
    //   res.status(200).json({
    //     success: true,
    //     message: "Limit increased successfully",
    //     data: result,
    //   });
    // });

    // get recipe for user added

    app.get("/api/recipes", verifyToken, verifyUser, async (req, res) => {
      const query = {};
      if (req.query.userId) {
        query.userId = req.query.userId;
      }
      const result = await recipesCollection.find(query).toArray();
      // console.log("result", result);
      res.status(200).json({
        status: true,
        message: "recipe fectched successfully",
        data: result,
      });
    });

    // public api
    app.get("/api/allrecipes", async (req, res) => {
      try {
        const { category, page = 1, limit = 10 } = req.query;

        const query = {};
        if (category) {
          query.category = category;
        }
        const currentPage = Number(page);
        const perPage = Number(limit);

        const skip = (currentPage - 1) * perPage;
        const recipes = await recipesCollection
          .find(query)
          .skip(skip)
          .limit(perPage)
          .toArray();
        const totalRecipes = await recipesCollection.countDocuments(query);
        res.status(200).json({
          status: true,
          data: recipes,
          pagination: {
            totalRecipes,
            currentPage,
            totalPages: Math.ceil(totalRecipes / perPage),
            perPage,
          },
        });
      } catch (error) {
        res.status(500).json({
          status: false,
          message: error.message,
        });
      }
    });
    app.get("/api/recipedetails/:id", async (req, res) => {
      const { id } = req.params;
      const query = {
        _id: new ObjectId(id),
      };
      const result = await recipesCollection.findOne(query);
      res.status(200).json({
        status: true,
        message: "single recipe fetched successfully",
        data: result,
      });
    });
    // recipe related api
    app.get("/api/popular/recipe", async (req, res) => {
      const result = await recipesCollection
        .find()
        .sort({ likeCount: 1 })
        .toArray();
      res.status(200).json({
        status: true,
        message: "popular recipe fetched successfully",
        data: result,
      });
    });
    app.get("/api/feature/recipe", async (req, res) => {
      const result = await recipesCollection
        .find({ isFeatured: true })
        .toArray();
      res.status(200).json({
        status: true,
        message: "featrue recipe fetched successfullly",
        data: result,
      });
    });
    app.get(
      "/api/singlerecipe/:id",
      verifyToken,
      verifyUser,
      async (req, res) => {
        const { id } = req.params;
        console.log(id);
        const query = {
          _id: new ObjectId(id),
        };
        const result = await recipesCollection.findOne(query);
        res.status(200).json({
          status: true,
          message: "single recipe fetched successfully",
          data: result,
        });
      },
    );

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

    app.patch(
      "/api/updaterecipe/:id",
      verifyToken,
      verifyUser,
      async (req, res) => {
        const { id } = req.params;
        const updateData = req.body;

        const result = await recipesCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: updateData,
          },
        );

        res.status(200).json({
          status: true,
          message: "update recipe successfully",
          data: result,
        });
      },
    );
    app.delete(
      "/api/deletercipe/:id",
      verifyToken,
      verifyUser,
      async (req, res) => {
        const { id } = req.params;
        const result = await recipesCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res
          .status(200)
          .json({ status: true, message: " recipe delete successfully" });
      },
    );

    app.patch(
      "/api/incrementlike/:id",
      verifyToken,
      verifyUser,
      async (req, res) => {
        const { id } = req.params;
        const result = await recipesCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $inc: {
              likesCount: 1,
            },
          },
        );
        res
          .status(200)
          .json({ status: true, message: "like this updated successfully" });
      },
    );

    // add fouvourite recipe
    app.get("/api/get/favourite", verifyToken, verifyUser, async (req, res) => {
      const result = await favouritesCollectio.find().toArray();
      res
        .status(200)
        .json({ status: true, message: "fetched all favourite", data: result });
    });
    app.post(
      "/api/add/fovourite",
      verifyToken,
      verifyUser,
      async (req, res) => {
        const data = req.body;
        const favourite = {
          ...data,
          createdAt: new Date(),
        };
        const result = await favouritesCollectio.insertOne(favourite);
        console.log("result", result);
        res
          .status(201)
          .json({ status: true, message: "add to favaourite successfully" });
      },
    );

    app.delete(
      "/api/deletefavourite/:id",
      verifyToken,
      verifyUser,
      async (req, res) => {
        const { id } = req.params;
        console.log(id);
        const query = {
          _id: id,
        };
        const result = await favouritesCollectio.deleteOne(query);
        console.log(result);
        res.status(200).json({
          status: true,
          message: "favourite recipe delete successfully",
        });
      },
    );
    // recipe report
    app.post(
      "/api/recipe/report",
      verifyToken,
      verifyUser,
      async (req, res) => {
        const result = await reportCollection.insertOne(req.body);
        res.status(201).json({ status: true, message: "report successfully" });
      },
    );
    app.get(
      "/api/recipe/report/get",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const result = await reportCollection.find().toArray();
        res
          .status(201)
          .json({ status: true, message: "get report successfully" });
      },
    );
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
