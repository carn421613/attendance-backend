import { auth } from "./firebase.js";

const backendUrl = "https://attendance-backend-qj36.onrender.com";

let semesters = [];


/* ======================
   CGPA CALCULATION
====================== */

function calculateCGPA(list) {

  if (!list || list.length === 0) return "0.00";

  const total = list.reduce((sum, s) => sum + Number(s.sgpa), 0);

  return (total / list.length).toFixed(2);

}


/* ======================
   ADD SEMESTER
====================== */

document.getElementById("addSemesterBtn").addEventListener("click", () => {

  const year = Number(document.getElementById("semYear").value);
  const semester = Number(document.getElementById("semNumber").value);
  const sgpa = Number(document.getElementById("sgpa").value);

  const subjects = document.getElementById("subjects").value
    .toLowerCase()
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  if (!year || !semester || !sgpa || subjects.length === 0) {
    alert("Fill all fields");
    return;
  }

  if (semesters.some(s => s.year === year && s.semester === semester)) {
    alert("Semester already added");
    return;
  }

  semesters.push({ year, semester, sgpa, subjects });

  renderSemesters();

  document.getElementById("semYear").value = "";
  document.getElementById("semNumber").value = "";
  document.getElementById("sgpa").value = "";
  document.getElementById("subjects").value = "";

});


/* ======================
   SAVE PROFILE
====================== */

document.getElementById("saveBtn").addEventListener("click", async () => {

  const user = auth.currentUser;

  if (!user) return alert("Login required");

  const token = await user.getIdToken();

  const payload = {

    uid: user.uid,

    branch: document.getElementById("branch").value,
    academicYear: document.getElementById("academicYear").value,

    currentYear: Number(document.getElementById("year").value),
    currentSemester: Number(document.getElementById("semester").value),

    semesters,
    cgpa: calculateCGPA(semesters)

  };

  const res = await fetch(`${backendUrl}/student/profile`, {

    method: "POST",

    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token
    },

    body: JSON.stringify(payload)

  });

  const data = await res.json();

  alert(data.message || "Profile saved");

});


/* ======================
   LOAD PROFILE
====================== */

auth.onAuthStateChanged(async (user) => {

  if (!user) return;

  const res = await fetch(`${backendUrl}/student/profile/${user.uid}`);

  const profile = await res.json();


  document.getElementById("branch").value = profile.branch || "";
  document.getElementById("academicYear").value = profile.academicYear || "";

  document.getElementById("year").value = profile.currentYear || "";
  document.getElementById("semester").value = profile.currentSemester || "";


  semesters = profile.semesters || [];

  renderSemesters();

});


/* ======================
   RENDER SEMESTERS
====================== */

function renderSemesters() {

  const div = document.getElementById("semesterList");

  div.innerHTML = "";

  semesters.forEach(s => {

    div.innerHTML += `
      <div>
        <strong>Year ${s.year} | Semester ${s.semester}</strong><br>
        SGPA: ${s.sgpa}<br>
        Subjects: ${s.subjects.join(", ")}
      </div><hr>
    `;

  });

  document.getElementById("cgpaDisplay").innerText =
    calculateCGPA(semesters);

}