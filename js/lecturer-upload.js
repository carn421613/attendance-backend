import { auth } from "../js/firebase.js";

const BASE_URL = "https://attendance-backend-qj36.onrender.com";


/* =========================
   LOAD COURSES
========================= */

async function loadCourses() {

  try {

    const res = await fetch(`${BASE_URL}/courses`);

    const courses = await res.json();

    const dropdown = document.getElementById("course");

    courses.forEach(c => {

      const option = document.createElement("option");

      option.value = c.id;
      option.textContent = c.name;

      dropdown.appendChild(option);

    });

  }

  catch (err) {

    console.error("Failed to load courses", err);

  }

}

document.addEventListener("DOMContentLoaded", loadCourses);


/* =========================
   UPLOAD CLASS PHOTO
========================= */

window.uploadClassPhoto = async function () {

  const branch = document.getElementById("branch").value;
  const academicYear = document.getElementById("academicYear").value;

  const year = document.getElementById("year").value;
  const semester = document.getElementById("semester").value;
  const course = document.getElementById("course").value;

  const photo = document.getElementById("photo").files[0];

  if (!branch || !academicYear || !year || !semester || !course || !photo) {

    alert("Please fill all fields");

    return;

  }

  const user = auth.currentUser;

  if (!user) {

    alert("You are not logged in");

    return;

  }

  const formData = new FormData();

  formData.append("lecturerUid", user.uid);

  formData.append("branch", branch);
  formData.append("academicYear", academicYear);

  formData.append("year", year);
  formData.append("semester", semester);

  formData.append("course", course);

  formData.append("photo", photo);

  try {

    const response = await fetch(`${BASE_URL}/upload-class-photo`, {

      method: "POST",
      body: formData

    });

    const data = await response.json();

    if (!response.ok) {

      alert(data.error || "Upload failed");

      return;

    }

    alert("Class photo uploaded successfully");

  }

  catch (err) {

    console.error(err);

    alert("Server error");

  }

};