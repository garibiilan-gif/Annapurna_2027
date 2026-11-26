// Checks firestore.rules on the local emulator: npm run test:rules (needs Java)
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection } from "firebase/firestore";

const OWNER = readFileSync("firestore.rules", "utf8").match(/request\.auth\.uid == "([^"]+)"/)[1];
let env;
before(async () => { env = await initializeTestEnvironment({ projectId: "demo-trek", firestore: { rules: readFileSync("firestore.rules", "utf8") } }); });
after(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c => {
    await setDoc(doc(c.firestore(), "trips/apr"), { trek: "annapurna", name: "April group", start: "2027-04-10", flights: {} });
    await setDoc(doc(c.firestore(), "tripAdmins/apr"), { emails: ["dana@example.com"] });
    await setDoc(doc(c.firestore(), "trips/oct"), { trek: "annapurna", name: "October group", start: null, flights: {} });
    await setDoc(doc(c.firestore(), "tripAdmins/oct"), { emails: ["sam@example.com"] });
  });
});
const owner = () => env.authenticatedContext(OWNER, { email: "owner@example.com", email_verified: true }).firestore();
const dana = (verified = true) => env.authenticatedContext("dana", { email: "Dana@example.com", email_verified: verified }).firestore();
const stranger = () => env.authenticatedContext("eve", { email: "eve@example.com", email_verified: true }).firestore();
const anon = () => env.unauthenticatedContext().firestore();

test("anyone can read and list trips", async () => {
  await assertSucceeds(getDoc(doc(anon(), "trips/apr")));
  await assertSucceeds(getDocs(collection(anon(), "trips")));
});
test("admin lists are private", async () => {
  await assertFails(getDoc(doc(anon(), "tripAdmins/apr")));
  await assertFails(getDoc(doc(stranger(), "tripAdmins/apr")));
  await assertSucceeds(getDoc(doc(dana(), "tripAdmins/apr")));
  await assertFails(getDoc(doc(dana(), "tripAdmins/oct")));
  await assertSucceeds(getDoc(doc(owner(), "tripAdmins/oct")));
});
test("a trip's admin can change its dates and flights", async () => {
  await assertSucceeds(updateDoc(doc(dana(), "trips/apr"), { start: "2027-04-12", flights: { chosen: "x" } }));
});
test("...but not the name, trek, or another trip", async () => {
  await assertFails(updateDoc(doc(dana(), "trips/apr"), { name: "Mine now" }));
  await assertFails(updateDoc(doc(dana(), "trips/apr"), { trek: "other" }));
  await assertFails(updateDoc(doc(dana(), "trips/oct"), { start: "2027-10-01" }));
  await assertFails(updateDoc(doc(dana(), "trips/apr"), { start: "next week" }));
});
test("an unconfirmed email gets no admin rights", async () => {
  await assertFails(updateDoc(doc(dana(false), "trips/apr"), { start: "2027-04-12" }));
});
test("viewers and strangers can't change anything", async () => {
  await assertFails(updateDoc(doc(anon(), "trips/apr"), { start: "2027-04-12" }));
  await assertFails(updateDoc(doc(stranger(), "trips/apr"), { start: "2027-04-12" }));
  await assertFails(setDoc(doc(stranger(), "trips/new"), { trek: "annapurna", name: "X" }));
  await assertFails(setDoc(doc(dana(), "tripAdmins/apr"), { emails: ["dana@example.com", "eve@example.com"] }));
  await assertFails(deleteDoc(doc(dana(), "trips/apr")));
});
test("the owner creates, renames, deletes trips and sets admins", async () => {
  await assertSucceeds(setDoc(doc(owner(), "trips/may"), { trek: "annapurna", name: "May group", start: null, flights: {} }));
  await assertFails(setDoc(doc(owner(), "trips/bad"), { trek: "annapurna", name: "" }));
  await assertSucceeds(updateDoc(doc(owner(), "trips/apr"), { name: "April group (A)" }));
  await assertSucceeds(setDoc(doc(owner(), "tripAdmins/may"), { emails: ["dana@example.com"] }));
  await assertSucceeds(deleteDoc(doc(owner(), "trips/oct")));
});
