require('dotenv').config();
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, setDoc, getDoc } = require('firebase/firestore/lite');

const firebaseConfig = {
    apiKey: "AIzaSyA98AqgNgh67RBCuxh6ee_j0Lh5udTMHj0",
    authDomain: "binshopeetips.firebaseapp.com",
    projectId: "binshopeetips",
    storageBucket: "binshopeetips.firebasestorage.app",
    messagingSenderId: "431904094355",
    appId: "1:431904094355:web:68796fa94c3f4ebd5af566",
    measurementId: "G-Q2Y2QWR2EC"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function test() {
    try {
        const testId = "test-12345";
        console.log("Saving user data...");
        await setDoc(doc(db, "users", testId), {
            name: "Test User",
            photoUrl: "https://example.com/photo.jpg",
            verified: false,
            lastActive: new Date().toISOString()
        }, { merge: true });
        console.log("Saved.");

        console.log("Reading user data...");
        const snap = await getDoc(doc(db, "users", testId));
        if (snap.exists()) {
            console.log("Data:", snap.data());
        } else {
            console.log("Document does not exist.");
        }
    } catch (e) {
        console.error("Firebase Error:");
        console.error(e);
    }
}
test();
