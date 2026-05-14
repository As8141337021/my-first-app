import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBN_7GBp1HkDx0d7Tf1LSyuQ9o1it5T1jU",
  authDomain: "trackingport-199ba.firebaseapp.com",
  projectId: "trackingport-199ba",
  storageBucket: "trackingport-199ba.firebasestorage.app",
  messagingSenderId: "967443299829",
  appId: "1:967443299829:web:17afc2e8dbe154d72fb4bc",
  measurementId: "G-BYP1G7YWKZ"
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
