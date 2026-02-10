import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyAQC-Jkr8P40AEuCycP1fG0JqkpIgLUVa8",
  authDomain: "connectionrecommendator.firebaseapp.com",
  projectId: "connectionrecommendator",
  storageBucket: "connectionrecommendator.firebasestorage.app",
  messagingSenderId: "329464695278",
  appId: "1:329464695278:web:8e6b20aa007a7580cd66ff",
  measurementId: "G-RT1WZPDW4F"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Auth and Google Provider
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
