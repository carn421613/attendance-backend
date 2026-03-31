import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from
"https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const BASE_URL = "https://attendance-backend-qj36.onrender.com";

const tableBody = document.querySelector("#requestsTable tbody");

onAuthStateChanged(auth, async (user) => {

  if (!user) return;

  const token = await user.getIdToken(true);

  try {

    const snapshot =
      await getDocs(collection(db, "enrollment_requests"));

    tableBody.innerHTML = "";

    snapshot.forEach(docSnap => {

      const data = docSnap.data();

      if (data.status !== "pending") return;

      const row = document.createElement("tr");

      row.innerHTML = `
        <td>${data.roll}</td>
        <td>${data.courseName || data.courseId}</td>
        <td>${data.status}</td>
        <td>
          <button onclick="processEnrollment('${docSnap.id}')">
            Process Enrollment
          </button>
        </td>
      `;

      tableBody.appendChild(row);

    });

  }

  catch (err) {

    console.error("Failed loading requests:", err);

  }


  /* =========================
     PROCESS ENROLLMENT
  ========================= */

  window.processEnrollment = async function (requestId) {

    try {

      const res = await fetch(
        `${BASE_URL}/approve-enrollment/${requestId}`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
          }
        }
      );

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Failed to approve");
        return;
      }

      alert(data.message || "Enrollment approved");

      location.reload();

    }

    catch (err) {

      console.error("APPROVE ERROR:", err);

      alert("Approval failed");

    }

  };

});