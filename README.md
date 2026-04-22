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

**What this tests:**

- **AI Pipeline Flow** - Sign in via Auth0, upload a messy CSV, prompt the AI to clean the data, handle clarification requests, wait for the pipeline to build and execute, preview the transformed output, download the results, and validate the downloaded content (schema, casing, deduplication).
- **Invalid Login** - Attempts login with wrong credentials and verifies an error message is shown.
- **Logout Flow** - Logs in, then logs out, and verifies the user is returned to a logged-out state.
- **Project Navigation** - Navigates to an existing project and verifies the pipeline canvas loads with its controls.

### Part 2 - API / Network-Level Tests

```bash
cd api-tests
npx playwright test
```

**What this tests:**

1. **Session authentication (positive)** - Verifies the session endpoint returns valid user info, a JWT access token, and a future expiry date
2. **Project listing (positive)** - Confirms the projects endpoint returns a paginated list of user projects when authenticated
3. **Invalid file upload (negative)** - Uploads garbage binary data and verifies the server rejects it
4. **Unauthenticated access (negative)** - Calls the API with no credentials and confirms it returns 401
5. **Download endpoint (positive)** - Finds a project with pipeline output, downloads it via the API, and verifies the response is valid CSV

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

- **Playwright over Cypress**: Playwright supports both UI and API testing in one framework. Its auto-wait mechanism handles async pipeline execution without fragile timeouts or blind sleeps.
- **Option A (AI Pipeline Flow)**: The AI pipeline is the core user journey and the highest-risk flow. If this breaks, users can't do anything meaningful with the product.
- **Role-based selectors**: More stable than CSS selectors. They survive UI redesigns as long as the semantic structure stays the same.
- **Environment variables for credentials**: Stored in `.env` (git-ignored) so secrets never touch the codebase or Git history.
- **Flexible assertions in API tests**: The negative upload test handles different server responses gracefully, since behavior for edge cases can vary between environments.
- **Data validation as a standalone script**: Written in Python with pandas for clear, readable validation logic that can run independently of the test framework.

## Known Limitations and Future Improvements

- The AI pipeline output is non-deterministic since it uses an LLM, so assertions focus on structural correctness rather than exact output matching.
- Pipeline execution can take 30-60 seconds depending on server load.
- Future improvements could include testing with multiple CSV formats, adding retry logic for flaky pipeline builds, and CI/CD integration via GitHub Actions.

## Demo Video

[Demo video walkthrough](https://youtu.be/1EuxVxXx7Sw)
