const XLSX = require("xlsx");
const wb = XLSX.readFile("D:\\AMG-Projects\\AMGEcosystem\\amgecosystem\\amgecosystem-v1.0.0\\Judy\\NFT-Files\\FinalGenerationAndTesting\\New-Judy\\NFTTRAITS.xlsx");
console.log("Sheets:", wb.SheetNames);
for (const name of wb.SheetNames) {
  const sheet = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  console.log(`\n=== ${name} (${rows.length} rows) ===`);
  console.log("Header:", JSON.stringify(rows[0]));
  console.log("Row 2:", JSON.stringify(rows[1]));
  console.log("Row 3:", JSON.stringify(rows[2]));
}
