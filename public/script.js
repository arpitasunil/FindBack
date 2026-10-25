
const itemsContainer = document.getElementById("itemsContainer");
const searchInput = document.getElementById("searchInput");
const filterButtons = document.querySelectorAll(".filter");
const reportForm = document.getElementById("reportForm");
const formMessage = document.getElementById("formMessage");

let allItems = [];
let currentStatus = "ALL";

// Safely display user-entered text.
function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const replacements = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return replacements[character];
  });
}

// Format the report date.
function formatDate(value) {
  if (!value) return "";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString();
}

// Find possible matches for lost items.
// Name, description, and location must all match.
function getPossibleMatches(lostItem) {
  const normalize = (value) =>
    String(value || "").trim().toLowerCase().replace(/\s+/g, " ");

  if (String(lostItem.ITEM_STATUS || "").toUpperCase() !== "LOST") {
    return [];
  }

  const lostName = normalize(lostItem.ITEM_NAME);
  const lostDescription = normalize(lostItem.ITEM_DESCRIPTION);
  const lostLocation = normalize(lostItem.LOCATION);

  if (!lostName || !lostDescription || !lostLocation) {
    return [];
  }

  return allItems.filter((foundItem) => {
    if (String(foundItem.ITEM_STATUS || "").toUpperCase() !== "FOUND") {
      return false;
    }

    return (
      normalize(foundItem.ITEM_NAME) === lostName &&
      normalize(foundItem.ITEM_DESCRIPTION) === lostDescription &&
      normalize(foundItem.LOCATION) === lostLocation
    );
  });
}

// Load items from Oracle through the server.
async function loadItems() {
  if (!itemsContainer) return;

  itemsContainer.innerHTML = "<p>Loading items...</p>";

  try {
    const response = await fetch("/api/items");

    if (!response.ok) {
      throw new Error("Could not load items from the server.");
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      throw new Error("Unexpected response from the server.");
    }

    allItems = data;
    displayItems();
  } catch (error) {
    console.error("FindBack loading error:", error);
    itemsContainer.innerHTML =
      "<p>Could not load items. Please check the server and try again.</p>";
  }
}

// Display items using search and status filters.
function displayItems() {
  if (!itemsContainer || !searchInput) return;

  const searchText = searchInput.value.toLowerCase().trim();

  const filteredItems = allItems.filter((item) => {
    const status = String(item.ITEM_STATUS || "").toUpperCase();

    const matchesStatus =
      currentStatus === "ALL" || status === currentStatus;

    const searchableText = [
      item.ITEM_NAME,
      item.CATEGORY,
      item.ITEM_DESCRIPTION,
      item.LOCATION
    ]
      .map((value) => String(value || "").toLowerCase())
      .join(" ");

    return matchesStatus && searchableText.includes(searchText);
  });

  if (filteredItems.length === 0) {
    itemsContainer.innerHTML = "<p>No matching items found.</p>";
    return;
  }

  itemsContainer.innerHTML = filteredItems.map((item) => {
    const status = String(item.ITEM_STATUS || "").toUpperCase();

    const matches = getPossibleMatches({
      ...item,
      ITEM_STATUS: status
    });

    return `
      <article class="item-card">
        <span class="status ${escapeHTML(status.toLowerCase())}">
          ${escapeHTML(status)}
        </span>

        <h3>${escapeHTML(item.ITEM_NAME || "Unnamed item")}</h3>

        <p>
          <strong>Category:</strong>
          ${escapeHTML(item.CATEGORY || "Other")}
        </p>

        <p>
          ${escapeHTML(item.ITEM_DESCRIPTION || "No description provided.")}
        </p>

        <p>
          <strong>Location:</strong>
          ${escapeHTML(item.LOCATION || "Not specified")}
        </p>

        <p class="item-date">
          ${escapeHTML(formatDate(item.REPORT_DATE))}
        </p>

        ${
          status === "FOUND"
            ? `<button type="button" class="claim-button"
                 data-id="${escapeHTML(item.ITEM_ID)}">
                 Claim Item
               </button>`
            : ""
        }

        ${
          matches.length > 0
            ? `
              <section class="possible-matches">
                <h4>Possible Match Found!</h4>
                <p>
                  A found report matches the item name, description,
                  and location. Please verify ownership.
                </p>

                ${matches.map((match) => `
                  <div>
                    <p>
                      <strong>Found report:</strong>
                      ${escapeHTML(match.ITEM_NAME)}
                    </p>
                    <p>
                      <strong>Location:</strong>
                      ${escapeHTML(match.LOCATION || "Not specified")}
                    </p>
                    <p>
                      <strong>Description:</strong>
                      ${escapeHTML(
                        match.ITEM_DESCRIPTION || "No description provided."
                      )}
                    </p>
                  </div>
                `).join("")}
              </section>
            `
            : ""
        }
      </article>
    `;
  }).join("");
}

// Search as the user types.
if (searchInput) {
  searchInput.addEventListener("input", displayItems);
}

// Filter by item status.
filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    currentStatus = String(button.dataset.status || "ALL").toUpperCase();

    filterButtons.forEach((filter) => {
      filter.classList.remove("active");
    });

    button.classList.add("active");
    displayItems();
  });
});

// Submit a lost or found report.
if (reportForm) {
  reportForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (formMessage) {
      formMessage.textContent = "Submitting report...";
    }

    const formData = new FormData(reportForm);

    const newItem = {
      itemName: String(formData.get("itemName") || "").trim(),
      category: String(formData.get("category") || "Other").trim(),
      description: String(formData.get("description") || "").trim(),
      location: String(formData.get("location") || "").trim(),
      itemStatus: String(formData.get("itemStatus") || "").toUpperCase()
    };

    try {
      const response = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newItem)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "Report submission failed.");
      }

      if (formMessage) {
        formMessage.textContent = "Report submitted successfully!";
      }

      reportForm.reset();
      await loadItems();
    } catch (error) {
      console.error("FindBack submission error:", error);

      if (formMessage) {
        formMessage.textContent =
          error.message || "Could not submit the report.";
      }
    }
  });
}

// Handle Claim Item button clicks.
if (itemsContainer) {
  itemsContainer.addEventListener("click", async (event) => {
    const button = event.target.closest(".claim-button");

    if (!button) return;

    const itemId = button.dataset.id;
    const claimantName = prompt("Enter your name:");

    if (!claimantName || !claimantName.trim()) {
      return;
    }

    const claimMessage =
      prompt("Why are you claiming this item?") || "";

    button.disabled = true;
    button.textContent = "Submitting...";

    try {
      const response = await fetch(
        `/api/items/${itemId}/claim-requests`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            claimantName: claimantName.trim(),
            claimMessage: claimMessage.trim()
          })
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.message || "Could not submit claim request."
        );
      }

      alert("Claim request submitted successfully!");
      await loadItems();
    } catch (error) {
      alert(error.message || "Something went wrong.");
      await loadItems();
    }
  });
}

// Claim request section.
const loadClaimRequestsButton =
  document.getElementById("loadClaimRequests");

const claimRequestsContainer =
  document.getElementById("claimRequestsContainer");

// Load claim requests when the button is clicked.
async function loadClaimRequests() {
  if (!claimRequestsContainer) return;

  claimRequestsContainer.textContent = "Loading claim requests...";

  try {
    const response = await fetch("/api/claim-requests");
    const requests = await response.json();

    if (!response.ok) {
      throw new Error(
        requests.message || "Could not load claim requests."
      );
    }

    if (!Array.isArray(requests)) {
      throw new Error("Unexpected claim requests response.");
    }

    if (requests.length === 0) {
      claimRequestsContainer.textContent = "No claim requests yet.";
      return;
    }

    claimRequestsContainer.innerHTML = requests.map((request) => {
      const status = String(
        request.REQUEST_STATUS || ""
      ).toUpperCase();

      return `
        <article class="item-card">
          <h3>${escapeHTML(request.ITEM_NAME)}</h3>

          <p>
            <strong>Claimant:</strong>
            ${escapeHTML(request.CLAIMANT_NAME)}
          </p>

          <p>
            <strong>Message:</strong>
            ${escapeHTML(request.CLAIM_MESSAGE || "No message")}
          </p>

          <p>
            <strong>Status:</strong>
            ${escapeHTML(status)}
          </p>

          ${
            status === "PENDING"
              ? `
                <button type="button"
                  data-request-id="${escapeHTML(request.REQUEST_ID)}"
                  data-decision="APPROVED">
                  Approve
                </button>

                <button type="button"
                  data-request-id="${escapeHTML(request.REQUEST_ID)}"
                  data-decision="REJECTED">
                  Reject
                </button>
              `
              : ""
          }
        </article>
      `;
    }).join("");
  } catch (error) {
    console.error("Claim requests error:", error);
    claimRequestsContainer.textContent = error.message;
  }
}

if (loadClaimRequestsButton && claimRequestsContainer) {
  loadClaimRequestsButton.addEventListener("click", loadClaimRequests);
}

// Approve or reject a claim request.
if (claimRequestsContainer) {
  claimRequestsContainer.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-request-id]");

    if (!button) return;

    const requestId = button.dataset.requestId;
    const decision = button.dataset.decision;

    button.disabled = true;

    try {
      const response = await fetch(
        `/api/claim-requests/${requestId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision })
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.message || "Could not update request."
        );
      }

      alert(result.message);
      await loadClaimRequests();
      await loadItems();
    } catch (error) {
      alert(error.message || "Something went wrong.");
      button.disabled = false;
    }
  });
}

// Load items when the page opens.
loadItems();
