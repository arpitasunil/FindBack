
require("dotenv").config();

const express = require("express");
const oracledb = require("oracledb");
const path = require("path");

const app = express();
const PORT = 3000;


app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

async function getConnection() {
  return oracledb.getConnection({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectString: process.env.DB_CONNECT_STRING
  });
}

// Test Oracle connection.
app.get("/api/health", async (req, res) => {
  let connection;
  try {
    connection = await getConnection();
    const result = await connection.execute(
      "SELECT 'Oracle connected successfully!' FROM dual"
    );
    res.json({ status: "success", message: result.rows[0][0] });
  } catch (error) {
    console.error("Health check failed:", error.message);
    res.status(500).json({ message: "Could not connect to Oracle." });
  } finally {
    if (connection) await connection.close();
  }
});

// Get all items.
app.get("/api/items", async (req, res) => {
  let connection;
  try {
    connection = await getConnection();
    const result = await connection.execute(
      `SELECT item_id AS "ITEM_ID",
              item_name AS "ITEM_NAME",
              category AS "CATEGORY",
              item_description AS "ITEM_DESCRIPTION",
              location AS "LOCATION",
              item_status AS "ITEM_STATUS",
              report_date AS "REPORT_DATE"
       FROM items
       ORDER BY report_date DESC`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Loading items failed:", error.message);
    res.status(500).json({ message: "Could not load items." });
  } finally {
    if (connection) await connection.close();
  }
});

// Report a lost or found item.
app.post("/api/items", async (req, res) => {
  const { itemName, category, description, location, itemStatus } = req.body;

  if (
    typeof itemName !== "string" || !itemName.trim() ||
    itemName.trim().length > 100 ||
    typeof location !== "string" || !location.trim() ||
    location.trim().length > 100 ||
    !["LOST", "FOUND"].includes(itemStatus) ||
    (category != null &&
      (typeof category !== "string" || category.length > 50)) ||
    (description != null &&
      (typeof description !== "string" || description.length > 300))
  ) {
    return res.status(400).json({ message: "Please enter valid item details." });
  }

  let connection;
  try {
    connection = await getConnection();
    await connection.execute(
      `INSERT INTO items
         (item_name, category, item_description, location, item_status)
       VALUES (:itemName, :category, :description, :location, :itemStatus)`,
      {
        itemName: itemName.trim(),
        category: category || "Other",
        description: description || null,
        location: location.trim(),
        itemStatus
      },
      { autoCommit: true }
    );
    res.status(201).json({ message: "Report submitted successfully!" });
  } catch (error) {
    console.error("Saving item failed:", error.message);
    res.status(500).json({ message: "Could not save the report." });
  } finally {
    if (connection) await connection.close();
  }
});

// Submit a claim request for a found item.
app.post("/api/items/:id/claim-requests", async (req, res) => {
  const itemId = Number(req.params.id);
  const { claimantName, claimMessage } = req.body;

  if (
    !Number.isInteger(itemId) || itemId <= 0 ||
    typeof claimantName !== "string" || !claimantName.trim() ||
    claimantName.trim().length > 100 ||
    (claimMessage != null &&
      (typeof claimMessage !== "string" || claimMessage.length > 300))
  ) {
    return res.status(400).json({ message: "Please enter valid claim details." });
  }

  let connection;
  try {
    connection = await getConnection();
    const result = await connection.execute(
      `INSERT INTO claim_requests
         (item_id, claimant_name, claim_message)
       SELECT item_id, :claimantName, :claimMessage
       FROM items
       WHERE item_id = :itemId AND item_status = 'FOUND'`,
      {
        itemId,
        claimantName: claimantName.trim(),
        claimMessage: claimMessage?.trim() || null
      },
      { autoCommit: true }
    );

    if (result.rowsAffected === 0) {
      return res.status(409).json({ message: "This item is not available to claim." });
    }
    res.status(201).json({ message: "Claim request submitted successfully!" });
  } catch (error) {
    console.error("Claim request failed:", error.message);
    res.status(500).json({ message: "Could not submit the claim request." });
  } finally {
    if (connection) await connection.close();
  }
});

// List claim requests.
app.get("/api/claim-requests", async (req, res) => {
  let connection;
  try {
    connection = await getConnection();
    const result = await connection.execute(
      `SELECT cr.request_id AS "REQUEST_ID",
              cr.item_id AS "ITEM_ID",
              i.item_name AS "ITEM_NAME",
              cr.claimant_name AS "CLAIMANT_NAME",
              cr.claim_message AS "CLAIM_MESSAGE",
              cr.request_status AS "REQUEST_STATUS",
              cr.request_date AS "REQUEST_DATE"
       FROM claim_requests cr
       JOIN items i ON i.item_id = cr.item_id
       ORDER BY cr.request_date DESC`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Loading claim requests failed:", error.message);
    res.status(500).json({ message: "Could not load claim requests." });
  } finally {
    if (connection) await connection.close();
  }
});

// Approve or reject a pending claim request.
app.patch("/api/claim-requests/:id", async (req, res) => {
  const requestId = Number(req.params.id);
  const { decision } = req.body;

  if (
    !Number.isInteger(requestId) || requestId <= 0 ||
    !["APPROVED", "REJECTED"].includes(decision)
  ) {
    return res.status(400).json({ message: "Invalid claim decision." });
  }

  let connection;
  try {
    connection = await getConnection();

    const requestResult = await connection.execute(
      `SELECT item_id
       FROM claim_requests
       WHERE request_id = :requestId
         AND request_status = 'PENDING'`,
      { requestId }
    );

    if (requestResult.rows.length === 0) {
      return res.status(409).json({ message: "Request not found or already reviewed." });
    }

    const itemId = requestResult.rows[0][0];

    if (decision === "APPROVED") {
      const itemResult = await connection.execute(
        `UPDATE items
         SET item_status = 'CLAIMED'
         WHERE item_id = :itemId
           AND item_status = 'FOUND'`,
        { itemId }
      );

      if (itemResult.rowsAffected === 0) {
        await connection.rollback();
        return res.status(409).json({ message: "This item is no longer available." });
      }
    }

    await connection.execute(
      `UPDATE claim_requests
       SET request_status = :decision
       WHERE request_id = :requestId
         AND request_status = 'PENDING'`,
      { decision, requestId }
    );

    await connection.commit();
    res.json({
      message: decision === "APPROVED"
        ? "Claim approved. Item marked as CLAIMED."
        : "Claim request rejected."
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Claim decision failed:", error.message);
    res.status(500).json({ message: "Could not process the claim decision." });
  } finally {
    if (connection) await connection.close();
  }
});

// Start the server last.

app.get("/api/test-route", (req, res) => {
  res.send("FindBack route is working!");
});

console.log("TEST ROUTE REGISTERED");
app.listen(PORT, () => {
  console.log(`FindBack running at http://localhost:${PORT}`);
});
