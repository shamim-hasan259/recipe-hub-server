const dns = require("node:dns");
dns.setServers(["1.1.1.1", "1.0.0.1"]);
const express = require("express");
const dontenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");
const { log } = require("node:console");
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
    // await client.connect();
    const recipeHubDB = client.db("recipe-hub");
    const recipesCollection = recipeHubDB.collection("recipes");
    const usersCollection = recipeHubDB.collection("user");
    const subscriptionsCollection = recipeHubDB.collection("subscriptions");
    const reportCollection = recipeHubDB.collection("reports");
    const favouritesCollectio = recipeHubDB.collection("favourites");
    const paymentCollection = recipeHubDB.collection("payments");

    // user related api
    app.get("/api/total/user", verifyToken, verifyAdmin, async (req, res) => {
      const users = await usersCollection.find().toArray();
      res.status(200).json({
        status: true,
        message: "all user fetched successfully",
        data: users,
      });
    });

    app.get("/api/premium/user", verifyToken, verifyAdmin, async (req, res) => {
      const premiumUser = await usersCollection
        .find({ plan: "premium" })
        .toArray();
      res.status(200).json({
        status: true,
        message: "all premium use fetched successfully",
        data: premiumUser,
      });
    });

    app.patch(
      "/api/user/block/unblock/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const { newBlockStatus } = req.body;

        // console.log( typeofnewBlockStatus);
        const query = {
          _id: new ObjectId(id),
        };
        const updateUser = {
          $set: { isBlocked: newBlockStatus },
        };
        const result = await usersCollection.updateOne(query, updateUser);
        console.log(result);
        res.status(200).json({
          status: true,
          message:
            updateUser === "true"
              ? "user blocked successfully"
              : "user unblocked succefully",
        });
      },
    );

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

        res
          .status(200)
          .json({ status: true, message: "user plan update successfully" });
      },
    );

    app.get(
      "/api/subscrition/get",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const result = await subscriptionsCollection.find().toArray();
        res.status(200).json({
          status: true,
          message: "subscription fetched successfully",
          data: result,
        });
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
      const query = {};
      if (req.query.userId) {
        query.userId = req.query.userId;
      }
      const result = await paymentCollection.find(query).toArray();
      res.status(200).json({
        status: true,
        message: "payments data fecteched successfully",
        data: result,
      });
    });

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

    // menej all recipe
    app.get("/api/all/recipe", verifyToken, verifyAdmin, async (req, res) => {
      const result = await recipesCollection.find().toArray();
      res.status(200).json({
        status: true,
        message: "all recipe fetched for admin",
        data: result,
      });
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

    app.get(
      "/api/singlerecipe/admin/:id",
      verifyToken,
      verifyAdmin,
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
          .json({ status: true, message: "recipe delete successfully" });
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

    // edit and delete recipe for admin
    app.patch(
      "/api/updaterecipe/admin/:id",
      verifyToken,
      verifyAdmin,
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
    app.patch(
      "/api/updaterfeatue/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        console.log(log);

        const result = await recipesCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: { isFeatured: true },
          },
        );
        console.log(result);

        res.status(200).json({
          status: true,
          message: "Recipe marked as featured successfully",
          data: result,
        });
      },
    );
    app.delete(
      "/api/deletercipe/admin/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        console.log(id);
        const result = await recipesCollection.deleteOne({
          _id: new ObjectId(id),
        });
        console.log(result);
        res
          .status(200)
          .json({ status: true, message: "admin recipe delete successfully" });
      },
    );

    // add fouvourite recipe
    app.get("/api/get/favourite", verifyToken, verifyUser, async (req, res) => {
      const query = {};
      if (req.query.userId) {
        query.userId = req.query.userId;
      }

      const result = await favouritesCollectio.find(query).toArray();
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
        const query = {
          _id: new ObjectId(id),
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
        res.status(201).json({
          status: true,
          message: "get report successfully",
          data: result,
        });
      },
    );

    app.delete(
      "/api/delete/reoprt/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const query = {
          _id: new ObjectId(id),
        };
        const result = await reportCollection.deleteOne(query);
        res.status(200).json({
          status: true,
          message: "delete report successfully",
          data: result,
        });
      },
    );
    app.delete(
      "/api/delete/recipe/report/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        console.log(id);
        const query = {
          _id: new ObjectId(id),
        };
        const result = await recipesCollection.deleteOne(query);
        console.log(result);
        res.status(200).json({
          status: true,
          message: "delete recipe successfully",
          data: result,
        });
      },
    );
    // await client.db("admin").command({ ping: 1 });
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

// const dns = require("node:dns");
// dns.setServers(["1.1.1.1", "1.0.0.1"]);
// const express = require("express");
// const dontenv = require("dotenv");
// const cors = require("cors");
// const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
// const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");
// const { log } = require("node:console");
// dontenv.config();

// const uri = process.env.MONGO_URI;

// const app = express();
// const PORT = process.env.PORT;

// app.use(
//   cors({
//     credentials: true,
//     origin: [process.env.CLIENT_URI],
//   }),
// );

// app.use(cors());
// app.use(express.json());

// const client = new MongoClient(uri, {
//   serverApi: {
//     version: ServerApiVersion.v1,
//     strict: true,
//     deprecationErrors: true,
//   },
// });
// const JWKS = createRemoteJWKSet(
//   new URL(`${process.env.CLIENT_URI}/api/auth/jwks`),
// );

// // ==========================================
// // MIDDLEWARES (ভেরিফিকেশন মিডলওয়্যার সমূহ)
// // ==========================================

// const verifyToken = async (req, res, next) => {
//   const authHeader = req.headers.authorization;

//   if (!authHeader || !authHeader.startsWith("Bearer")) {
//     return res.status(401).json({ msg: "Unauthorized" });
//   }
//   const token = authHeader.split(" ")[1];
//   console.log(token);

//   if (!token) {
//     return res.status(401).json({ msg: "Unauthorized" });
//   }
//   try {
//     const { payload } = await jwtVerify(token, JWKS);
//     req.user = payload;
//     next();
//   } catch (error) {
//     console.log(error);
//     return res.status(401).json({ msg: "Unauthorized" });
//   }
// };

// const verifyUser = (req, res, next) => {
//   if (req.user.role !== "user") {
//     return res.status(403).json({ status: false, message: "Forbidden" });
//   }
//   next();
// };

// const verifyAdmin = (req, res, next) => {
//   if (req.user.role !== "admin") {
//     return res.status(403).json({ status: false, message: "Forbidden" });
//   }
//   next();
// };

// async function run() {
//   try {
//     await client.connect();
//     const recipeHubDB = client.db("recipe-hub");
//     const recipesCollection = recipeHubDB.collection("recipes");
//     const usersCollection = recipeHubDB.collection("user");
//     const subscriptionsCollection = recipeHubDB.collection("subscriptions");
//     const reportCollection = recipeHubDB.collection("reports");
//     const favouritesCollectio = recipeHubDB.collection("favourites");
//     const paymentCollection = recipeHubDB.collection("payments");

//     // =========================================================================
//     // 1. USER COLLECTION RELATED APIS (ইউজার কালেকশন সম্পর্কিত এপিআই)
//     // =========================================================================

//     // [ACCESS: Admin Only] - সব ইউজার ডাটা নিয়ে আসার জন্য
//     app.get("/api/total/user", verifyToken, verifyAdmin, async (req, res) => {
//       const users = await usersCollection.find().toArray();
//       res.status(200).json({
//         status: true,
//         message: "all user fetched successfully",
//         data: users,
//       });
//     });

//     // [ACCESS: Admin Only] - সব প্রিমিয়াম ইউজার ডাটা নিয়ে আসার জন্য
//     app.get("/api/premium/user", verifyToken, verifyAdmin, async (req, res) => {
//       const premiumUser = await usersCollection
//         .find({ plan: "premium" })
//         .toArray();
//       res.status(200).json({
//         status: true,
//         message: "all premium use fetched successfully",
//         data: premiumUser,
//       });
//     });

//     // [ACCESS: Admin Only] - ইউজার ব্লক বা আনব্লক করার জন্য
//     app.patch(
//       "/api/user/block/unblock/:id",
//       verifyToken,
//       verifyAdmin,
//       async (req, res) => {
//         const { id } = req.params;
//         const { newBlockStatus } = req.body;

//         const query = {
//           _id: new ObjectId(id),
//         };
//         const updateUser = {
//           $set: { isBlocked: newBlockStatus },
//         };
//         const result = await usersCollection.updateOne(query, updateUser);
//         console.log(result);
//         res.status(200).json({
//           status: true,
//           message:
//             updateUser === "true"
//               ? "user blocked successfully"
//               : "user unblocked succefully",
//         });
//       },
//     );

//     // =========================================================================
//     // 2. RECIPES COLLECTION RELATED APIS (রেসিপি কালেকশন সম্পর্কিত এপিআই)
//     // =========================================================================

//     // [ACCESS: Public] - সব রেসিপি পেজিনেশন ও ক্যাটাগরি ফিল্টার সহ দেখার জন্য
//     app.get("/api/allrecipes", async (req, res) => {
//       try {
//         const { category, page = 1, limit = 10 } = req.query;

//         const query = {};
//         if (category) {
//           query.category = category;
//         }
//         const currentPage = Number(page);
//         const perPage = Number(limit);

//         const skip = (currentPage - 1) * perPage;
//         const recipes = await recipesCollection
//           .find(query)
//           .skip(skip)
//           .limit(perPage)
//           .toArray();
//         const totalRecipes = await recipesCollection.countDocuments(query);
//         res.status(200).json({
//           status: true,
//           data: recipes,
//           pagination: {
//             totalRecipes,
//             currentPage,
//             totalPages: Math.ceil(totalRecipes / perPage),
//             perPage,
//           },
//         });
//       } catch (error) {
//         res.status(500).json({
//           status: false,
//           message: error.message,
//         });
//       }
//     });

//     // [ACCESS: Public] - নির্দিষ্ট আইডি অনুযায়ী একটি রেসিপির ডিটেইলস দেখার জন্য
//     app.get("/api/recipedetails/:id", async (req, res) => {
//       const { id } = req.params;
//       const query = {
//         _id: new ObjectId(id),
//       };
//       const result = await recipesCollection.findOne(query);
//       res.status(200).json({
//         status: true,
//         message: "single recipe fetched successfully",
//         data: result,
//       });
//     });

//     // [ACCESS: Public] - পপুলার রেসিপি লাইক কাউন্ট অনুযায়ী শর্ট করে দেখার জন্য
//     app.get("/api/popular/recipe", async (req, res) => {
//       const result = await recipesCollection
//         .find()
//         .sort({ likeCount: 1 })
//         .toArray();
//       res.status(200).json({
//         status: true,
//         message: "popular recipe fetched successfully",
//         data: result,
//       });
//     });

//     // [ACCESS: Public] - ফিচারড রেসিপিগুলো দেখার জন্য
//     app.get("/api/feature/recipe", async (req, res) => {
//       const result = await recipesCollection
//         .find({ isFeatured: true })
//         .toArray();
//       res.status(200).json({
//         status: true,
//         message: "featrue recipe fetched successfullly",
//         data: result,
//       });
//     });

//     // [ACCESS: User Only] - লগইন করা ইউজারের নিজের রেসিপিগুলো দেখার জন্য
//     app.get("/api/recipes", verifyToken, verifyUser, async (req, res) => {
//       const query = {};
//       if (req.query.userId) {
//         query.userId = req.query.userId;
//       }
//       const result = await recipesCollection.find(query).toArray();
//       res.status(200).json({
//         status: true,
//         message: "recipe fectched successfully",
//         data: result,
//       });
//     });

//     // [ACCESS: User Only] - লগইন করা ইউজার কর্তৃক নির্দিষ্ট একটি রেসিপি দেখার জন্য
//     app.get(
//       "/api/singlerecipe/:id",
//       verifyToken,
//       verifyUser,
//       async (req, res) => {
//         const { id } = req.params;
//         console.log(id);
//         const query = {
//           _id: new ObjectId(id),
//         };
//         const result = await recipesCollection.findOne(query);
//         res.status(200).json({
//           status: true,
//           message: "single recipe fetched successfully",
//           data: result,
//         });
//       },
//     );

//     // [ACCESS: User Only] - নতুন রেসিপি তৈরি বা পোস্ট করার জন্য
//     app.post("/api/recipes", verifyToken, verifyUser, async (req, res) => {
//       const body = req.body;
//       const data = {
//         ...body,
//         createdAt: new Date(),
//       };
//       const result = await recipesCollection.insertOne(data);

//       res.status(201).json({
//         status: true,
//         message: "recipe created successfully",
//         data: result,
//       });
//     });

//     // [ACCESS: User Only] - ইউজারের নিজের রেসিপি আপডেট করার জন্য
//     app.patch(
//       "/api/updaterecipe/:id",
//       verifyToken,
//       verifyUser,
//       async (req, res) => {
//         const { id } = req.params;
//         const updateData = req.body;

//         const result = await recipesCollection.updateOne(
//           { _id: new ObjectId(id) },
//           {
//             $set: updateData,
//           },
//         );

//         res.status(200).json({
//           status: true,
//           message: "update recipe successfully",
//           data: result,
//         });
//       },
//     );

//     // [ACCESS: User Only] - ইউজারের নিজের রেসিপি ডিলিট করার জন্য
//     app.delete(
//       "/api/deletercipe/:id",
//       verifyToken,
//       verifyUser,
//       async (req, res) => {
//         const { id } = req.params;
//         const result = await recipesCollection.deleteOne({
//           _id: new ObjectId(id),
//         });
//         res
//           .status(200)
//           .json({ status: true, message: "recipe delete successfully" });
//       },
//     );

//     // [ACCESS: User Only] - রেসিপিতে লাইক বাড়ানোর জন্য ($inc)
//     app.patch(
//       "/api/incrementlike/:id",
//       verifyToken,
//       verifyUser,
//       async (req, res) => {
//         const { id } = req.params;
//         const result = await recipesCollection.updateOne(
//           { _id: new ObjectId(id) },
//           {
//             $inc: {
//               likesCount: 1,
//             },
//           },
//         );
//         res
//           .status(200)
//           .json({ status: true, message: "like this updated successfully" });
//       },
//     );

//     // [ACCESS: Admin Only] - অ্যাডমিন প্যানেল থেকে সব রেসিপি একসাথে দেখার জন্য
//     app.get("/api/all/recipe", verifyToken, verifyAdmin, async (req, res) => {
//       const result = await recipesCollection.find().toArray();
//       res.status(200).json({
//         status: true,
//         message: "all recipe fetched for admin",
//         data: result,
//       });
//     });

//     // [ACCESS: Admin Only] - অ্যাডমিন কর্তৃক নির্দিষ্ট একটি রেসিপি দেখার জন্য
//     app.get(
//       "/api/singlerecipe/admin/:id",
//       verifyToken,
//       verifyAdmin,
//       async (req, res) => {
//         const { id } = req.params;
//         console.log(id);
//         const query = {
//           _id: new ObjectId(id),
//         };
//         const result = await recipesCollection.findOne(query);
//         res.status(200).json({
//           status: true,
//           message: "single recipe fetched successfully",
//           data: result,
//         });
//       },
//     );

//     // [ACCESS: Admin Only] - অ্যাডমিন কর্তৃক যেকোনো রেসিপি আপডেট করার জন্য
//     app.patch(
//       "/api/updaterecipe/admin/:id",
//       verifyToken,
//       verifyAdmin,
//       async (req, res) => {
//         const { id } = req.params;
//         const updateData = req.body;

//         const result = await recipesCollection.updateOne(
//           { _id: new ObjectId(id) },
//           {
//             $set: updateData,
//           },
//         );
//         res.status(200).json({
//           status: true,
//           message: "update recipe successfully",
//           data: result,
//         });
//       },
//     );

//     // [ACCESS: Admin Only] - কোনো রেসিপিকে ফিচারড (isFeatured: true) করার জন্য
//     app.patch(
//       "/api/updaterfeatue/:id",
//       verifyToken,
//       verifyAdmin,
//       async (req, res) => {
//         const { id } = req.params;
//         console.log(log);

//         const result = await recipesCollection.updateOne(
//           { _id: new ObjectId(id) },
//           {
//             $set: { isFeatured: true },
//           },
//         );
//         console.log(result);

//         res.status(200).json({
//           status: true,
//           message: "Recipe marked as featured successfully",
//           data: result,
//         });
//       },
//     );

//     // [ACCESS: Admin Only] - অ্যাডমিন কর্তৃক যেকোনো রেসিপি ডিলিট করার জন্য
//     app.delete(
//       "/api/deletercipe/admin/:id",
//       verifyToken,
//       verifyAdmin,
//       async (req, res) => {
//         const { id } = req.params;
//         console.log(id);
//         const result = await recipesCollection.deleteOne({
//           _id: new ObjectId(id),
//         });
//         console.log(result);
//         res
//           .status(200)
//           .json({ status: true, message: "admin recipe delete successfully" });
//       },
//     );

//     // =========================================================================
//     // 3. SUBSCRIPTIONS COLLECTION RELATED APIS (সাবস্ক্রিপশন কালেকশন সম্পর্কিত এপিআই)
//     // =========================================================================

//     // [ACCESS: User Only] - নতুন সাবস্ক্রিপশন নেওয়া এবং ইউজারের প্ল্যান প্রিমিয়াম করার জন্য
//     app.post(
//       "/api/subscriptions",
//       verifyToken,
//       verifyUser,
//       async (req, res) => {
//         const { sessionId, userId, priceId } = req.body;
//         const exist = await subscriptionsCollection.findOne({ userId });
//         if (exist) {
//           return res.json({ message: "Already Exsist" });
//         }

//         const subucriptionData = await subscriptionsCollection.insertOne({
//           sessionId,
//           userId,
//           priceId,
//           createdAt: new Date(),
//         });
//         await usersCollection.updateOne(
//           { _id: new ObjectId(userId) },
//           {
//             $set: {
//               plan: "premium",
//             },
//           },
//         );

//         res
//           .status(200)
//           .json({ status: true, message: "user plan update successfully" });
//       },
//     );

//     // [ACCESS: Admin Only] - সব সাবস্ক্রিপশনের ডাটা দেখার জন্য
//     app.get(
//       "/api/subscrition/get",
//       verifyToken,
//       verifyAdmin,
//       async (req, res) => {
//         const result = await subscriptionsCollection.find().toArray();
//         res.status(200).json({
//           status: true,
//           message: "subscription fetched successfully",
//           data: result,
//         });
//       },
//     );

//     // =========================================================================
//     // 4. PAYMENTS COLLECTION RELATED APIS (পেমেন্ট কালেকশন সম্পর্কিত এপিআই)
//     // =========================================================================

//     // [ACCESS: User Only] - পেমেন্ট ইনফরমেশন ডাটাবেজে সেভ করার জন্য
//     app.post("/api/payments", verifyToken, verifyUser, async (req, res) => {
//       const data = req.body;
//       const paymentsData = {
//         ...data,
//         createdAt: new Date(),
//       };
//       const result = await paymentCollection.insertOne(paymentsData);
//       res.status(201).json({ status: true, message: "payments successfully" });
//     });

//     // [ACCESS: User Only] - ইউজারের আইডি অনুযায়ী পেমেন্ট হিস্ট্রি ডাটা নিয়ে আসার জন্য
//     app.get("/api/getpayments", verifyToken, verifyUser, async (req, res) => {
//       const query = {};
//       if (req.query.userId) {
//         query.userId = req.query.userId;
//       }
//       const result = await paymentCollection.find(query).toArray();
//       res.status(200).json({
//         status: true,
//         message: "payments data fecteched successfully",
//         data: result,
//       });
//     });

//     // =========================================================================
//     // 5. FAVOURITES COLLECTION RELATED APIS (ফেভারিটস কালেকশন সম্পর্কিত এপিআই)
//     // =========================================================================

//     // [ACCESS: User Only] - ইউজারের আইডি অনুযায়ী পছন্দের বা ফেভারিট রেসিপিগুলো দেখার জন্য
//     app.get("/api/get/favourite", verifyToken, verifyUser, async (req, res) => {
//       const query = {};
//       if (req.query.userId) {
//         query.userId = req.query.userId;
//       }

//       const result = await favouritesCollectio.find(query).toArray();
//       res
//         .status(200)
//         .json({ status: true, message: "fetched all favourite", data: result });
//     });

//     // [ACCESS: User Only] - ফেভারিট লিস্টে নতুন রেসিপি যোগ করার জন্য
//     app.post(
//       "/api/add/fovourite",
//       verifyToken,
//       verifyUser,
//       async (req, res) => {
//         const data = req.body;
//         const favourite = {
//           ...data,
//           createdAt: new Date(),
//         };
//         const result = await favouritesCollectio.insertOne(favourite);
//         console.log("result", result);
//         res
//           .status(201)
//           .json({ status: true, message: "add to favaourite successfully" });
//       },
//     );

//     // [ACCESS: User Only] - ফেভারিট লিস্ট থেকে কোনো রেসিপি ডিলিট করার জন্য
//     app.delete(
//       "/api/deletefavourite/:id",
//       verifyToken,
//       verifyUser,
//       async (req, res) => {
//         const { id } = req.params;
//         const query = {
//           _id: new ObjectId(id),
//         };
//         const result = await favouritesCollectio.deleteOne(query);
//         console.log(result);
//         res.status(200).json({
//           status: true,
//           message: "favourite recipe delete successfully",
//         });
//       },
//     );

//     // =========================================================================
//     // 6. REPORTS COLLECTION RELATED APIS (রিপোর্ট কালেকশন সম্পর্কিত এপিআই)
//     // =========================================================================

//     // [ACCESS: User Only] - কোনো রেসিপির বিরুদ্ধে রিপোর্ট জমা দেওয়ার জন্য
//     app.post(
//       "/api/recipe/report",
//       verifyToken,
//       verifyUser,
//       async (req, res) => {
//         const result = await reportCollection.insertOne(req.body);
//         res.status(201).json({ status: true, message: "report successfully" });
//       },
//     );

//     // [ACCESS: Admin Only] - সব রিপোর্টের ডাটা দেখার জন্য
//     app.get(
//       "/api/recipe/report/get",
//       verifyToken,
//       verifyAdmin,
//       async (req, res) => {
//         const result = await reportCollection.find().toArray();
//         res.status(201).json({
//           status: true,
//           message: "get report successfully",
//           data: result,
//         });
//       },
//     );

//     // [ACCESS: Admin Only] - নির্দিষ্ট কোনো রিপোর্ট ডিলিট করার জন্য
//     app.delete(
//       "/api/delete/reoprt/:id",
//       verifyToken,
//       verifyAdmin,
//       async (req, res) => {
//         const { id } = req.params;
//         const query = {
//           _id: new ObjectId(id),
//         };
//         const result = await reportCollection.deleteOne(query);
//         res.status(200).json({
//           status: true,
//           message: "delete report successfully",
//           data: result,
//         });
//       },
//     );

//     // =========================================================================
//     // MONGO PING STATUS
//     // =========================================================================
//     await client.db("admin").command({ ping: 1 });
//     console.log(
//       "Pinged your deployment. You successfully connected to MongoDB!",
//     );
//   } finally {
//     // Ensures that the client will close when you finish/error
//     // await client.close();
//   }
// }
// run().catch(console.dir);

// app.listen(PORT, () => {
//   console.log(`Server running on port ${PORT}`);
// });
