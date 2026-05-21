const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");

dotenv.config();

const uri = process.env.MONGODB_URI;

const app = express();
const PORT = process.env.PORT;

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
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`)
);


const verifyToken = async (req, res, next) => {
  const authHeader = req?.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    req.user = payload;
    next();
  } catch (error) {
    return res.status(403).json({ message: "Forbidden" });
  }
};

async function run() {
  try {
    // await client.connect();

    const db = client.db("mediqueue");

    const tutorCollection = db.collection("tutors");
    const bookingsCollection = db.collection("bookings");


    app.get("/tutor", async (req, res) => {
      try {
        const { search, startDate, endDate } = req.query;

        const query = {};

        if (search) {
          query.tutorName = {
            $regex: search,
            $options: "i",
          };
        }

        if (startDate || endDate) {
          query.departureDate = {};

          if (startDate) query.departureDate.$gte = startDate;
          if (endDate) query.departureDate.$lte = endDate;
        }

        const result = await tutorCollection.find(query).toArray();
        res.json(result);
      } catch (error) {
        res.status(500).json({
          message: "Server error",
          error: error.message,
        });
      }
    });


    app.get("/my-tutors/:email", verifyToken, async (req, res) => {
      try {
        const { email } = req.params;

        const result = await tutorCollection.find({ email }).toArray();
        res.json(result);
      } catch {
        res.status(500).json({ message: "Server error" });
      }
    });


    app.post("/tutor", verifyToken, async (req, res) => {
      try {
        const tutorData = req.body;

        const newTutor = {
          ...tutorData,
          fee: Number(tutorData.fee),   // 🔥 FIX
          slot: Number(tutorData.slot), // 🔥 FIX
          email: req.user.email,
          createdAt: new Date(),
        };

        const result = await tutorCollection.insertOne(newTutor);
        res.json(result);
      } catch {
        res.status(500).json({ message: "Failed to add tutor" });
      }
    });


    app.get("/tutor/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid tutor id" });
        }

        const result = await tutorCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!result) {
          return res.status(404).json({ message: "Tutor not found" });
        }

        res.json(result);
      } catch {
        res.status(500).json({ message: "Server error" });
      }
    });


    app.get("/featured-tutors", async (req, res) => {
      const result = await tutorCollection.find().limit(6).toArray();
      res.json(result);
    });


    app.delete("/tutors/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;

        const result = await tutorCollection.deleteOne({
          _id: new ObjectId(id),
        });

        res.json(result);
      } catch {
        res.status(500).json({ message: "Delete failed" });
      }
    });


    app.patch("/tutors/:id", verifyToken, async (req, res) => {
      const { id } = req.params;

      const updatedData = {
        ...req.body,
        fee: Number(req.body.fee),   // 🔥 FIX
        slot: Number(req.body.slot), // 🔥 FIX
      };

      const result = await tutorCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedData }
      );

      res.json(result);
    });


    app.post("/bookings", verifyToken, async (req, res) => {
      try {
        const bookingData = req.body;

        const tutorId = bookingData.tutorId;

        if (!ObjectId.isValid(tutorId)) {
          return res.status(400).json({
            success: false,
            message: "Invalid tutor id",
          });
        }

        const tutor = await tutorCollection.findOne({
          _id: new ObjectId(tutorId),
        });

        if (!tutor) {
          return res.status(404).json({
            success: false,
            message: "Tutor not found",
          });
        }


        const currentSlot = Number(tutor.slot || 0);

        if (isNaN(currentSlot)) {
          return res.status(500).json({
            success: false,
            message: "Invalid slot data in database",
          });
        }

        if (currentSlot <= 0) {
          return res.status(400).json({
            success: false,
            message: "No slots available",
          });
        }

        bookingData.userEmail = req.user.email;
        bookingData.userId = req.user.id || bookingData.userId;

        const result = await bookingsCollection.insertOne(bookingData);

        await tutorCollection.updateOne(
          { _id: new ObjectId(tutorId) },
          {
            $inc: { slot: -1 },
          }
        );

        res.status(201).json({
          success: true,
          message: "Booking successful",
          insertedId: result.insertedId,
        });

      } catch (error) {
        res.status(500).json({
          success: false,
          message: "Booking failed",
          error: error.message,
        });
      }
    });


    app.get("/bookings/:userId", async (req, res) => {
      const result = await bookingsCollection
        .find({ userId: req.params.userId })
        .toArray();

      res.json(result);
    });

    app.get("/bookings", async (req, res) => {
      const email = req.query.email;

      const query = email ? { email } : {};

      const result = await bookingsCollection.find(query).toArray();
      res.json(result);
    });

    
    app.patch("/bookings/:bookingId", verifyToken, async (req, res) => {
      const { bookingId } = req.params;

      const result = await bookingsCollection.updateOne(
        { _id: new ObjectId(bookingId) },
        { $set: { status: "cancelled" } }
      );

      res.json(result);
    });

    // await client.db("admin").command({ ping: 1 });

    console.log("MongoDB connected successfully!");
  } finally {
  }
}

run().catch(console.dir);

// =========================
app.get("/", (req, res) => {
  res.send("Server is running fine!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});