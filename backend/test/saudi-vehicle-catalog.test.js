import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const makes = JSON.parse(
  readFileSync(
    new URL("../src/data/saudi-vehicle-makes.json", import.meta.url),
    "utf8"
  )
);

const vehicleRoute = readFileSync(
  new URL("../src/routes/vehicles.js", import.meta.url),
  "utf8"
);

test("Saudi vehicle make catalog has unique stable codes", () => {
  assert.ok(makes.length >= 70);

  const codes = makes.map((item) => item.code);
  assert.equal(new Set(codes).size, codes.length);

  for (const make of makes) {
    assert.match(make.code, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(make.nameEn);
    assert.ok(make.nameAr);
    assert.ok(make.country);
  }
});

test("Saudi vehicle catalog includes core market makes", () => {
  const codes = new Set(makes.map((item) => item.code));

  for (const code of [
    "toyota",
    "lexus",
    "nissan",
    "hyundai",
    "kia",
    "ford",
    "chevrolet",
    "gmc",
    "mercedes-benz",
    "bmw",
    "geely",
    "changan",
    "haval",
    "jetour",
    "byd",
  ]) {
    assert.ok(codes.has(code), `missing make: ${code}`);
  }
});

test("vehicle catalog API is Saudi scoped and read only", () => {
  assert.match(
    vehicleRoute,
    /router\.get\("\/catalog\/makes"/
  );

  assert.match(
    vehicleRoute,
    /market:\s*"SA"/
  );

  assert.doesNotMatch(
    vehicleRoute,
    /router\.(post|put|patch|delete)\("\/catalog\/makes"/
  );
});

test("customer vehicle persistence remains separate from reference catalog", () => {
  assert.match(
    vehicleRoute,
    /INSERT INTO customer_vehicles/
  );

  assert.doesNotMatch(
    vehicleRoute,
    /INSERT INTO .*saudiVehicleMakes/
  );
});
