# Rhombus AI - QA Test Suite

Automated test suite for the [Rhombus AI](https://rhombusai.com/) web application, covering UI automation, API testing, and data validation.

## Project Structure

```
rhombus-qa/
  ui-tests/          # Playwright UI automation tests
  api-tests/         # API / network-level tests
  data-validation/   # Python data validation script
  test-data/         # Test fixtures (input CSV, output CSV)
```

## Prerequisites

- **Node.js** v18 or later
- **Python** 3.10 or later
- **pandas** Python library
- A Rhombus AI account (free sign-up at https://rhombusai.com/)

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/joeljorly/rhombus-qa.git
cd rhombus-qa
```

### 2. Create a `.env` file in the project root

```bash
cp .env.example .env
```

Edit `.env` and add your Rhombus AI credentials:

```
RHOMBUS_EMAIL=your_email@example.com
RHOMBUS_PASSWORD=your_password_here
```

### 3. Install UI test dependencies

```bash
cd ui-tests
npm install
npx playwright install
cd ..
```

### 4. Install API test dependencies

```bash
cd api-tests
npm install
npx playwright install
cd ..
```

### 5. Install Python dependencies

```bash
pip3 install pandas
```

## Running the Tests

### Part 1 - UI Automation Tests

```bash
cd ui-tests
npx playwright test
```

To run in headed mode (see the browser):

```bash
npx playwright test --headed
```

To run in debug mode (step through):

```bash
npx playwright test --debug
```

**What this tests:** The complete AI Pipeline Flow - sign in, upload a messy CSV, prompt the AI to clean the data, wait for the pipeline to execute, preview the transformed output, and download the results. The test verifies that the output contains valid data with lowercase text and fewer rows than the input (duplicates removed).

### Part 2 - API / Network-Level Tests

```bash
cd api-tests
npx playwright test
```

**What this tests:**

1. **Session authentication** - Verifies that a logged-in session returns valid user information and a JWT access token
2. **Dataset upload (positive)** - Confirms that a valid CSV file can be uploaded to a project and returns correct metadata
3. **Invalid file upload (negative)** - Attempts to upload garbage binary data and verifies the server handles it appropriately
4. **Unauthenticated access (negative)** - Confirms that API endpoints reject requests without authentication

### Part 3 - Data Validation

```bash
cd data-validation
python3 validate.py
```

To specify custom file paths:

```bash
python3 validate.py --input ../test-data/messy_data.csv --output ../test-data/output_cleaned.csv
```

**What this validates:**

1. **Schema correctness** - Output columns match the input columns
2. **Row count** - Output has fewer rows than input (duplicates were removed)
3. **Text casing** - All text columns are converted to lowercase
4. **No duplicates** - Output contains no exact duplicate rows
5. **Data integrity** - Output data is a subset of input data (no rows were invented)

## Test Data

The input file (`test-data/messy_data.csv`) contains 20 rows with deliberate data quality issues:

- Duplicate rows (exact and case-variant)
- Missing values in various columns
- Invalid ages (negative numbers, text instead of numbers)
- Invalid email formats
- Inconsistent date formats
- Outlier salary values

The AI pipeline is prompted to remove duplicates and standardize text to lowercase. The data validation script then verifies these transformations were applied correctly.

## Design Decisions

- **Playwright over Cypress**: Playwright has built-in support for API testing via `request` contexts, which allowed me to use one tool for both UI and API tests. Its auto-wait mechanism also helps handle the async pipeline execution without fragile timeouts.
- **Option A (AI Pipeline Flow)**: Chosen because it tests the core AI-driven feature of the product. While manual transformations are more deterministic, the AI pipeline is the primary user journey and the higher-risk flow to validate.
- **Environment variables for credentials**: Credentials are stored in `.env` (git-ignored) rather than hardcoded, following security best practices.
- **Flexible assertions in API tests**: The negative upload test handles both rejection (4xx) and acceptance scenarios gracefully, since the server's behavior for edge cases may vary.
- **Data validation as a standalone script**: Written in Python with pandas for clear, readable validation logic that can be run independently of the test framework.

## Demo Video

[Demo video link](TODO_ADD_LINK_HERE)

## Notes

- Tests run against the live production Rhombus AI application
- The AI pipeline behavior may vary slightly between runs since it uses an LLM, so assertions focus on structural correctness rather than exact output matching
- Pipeline execution can take 30-60 seconds depending on server load
