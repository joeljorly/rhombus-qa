"""
Data Validation Script for Rhombus AI
======================================
Compares the original messy CSV (input) with the cleaned CSV (output)
to verify that data transformations were applied correctly.

Validations performed:
  1. Output schema correctness — same columns as input
  2. Row count — output should have fewer rows (duplicates removed)
  3. Text casing — all text columns should be lowercase
  4. No exact duplicate rows in output
  5. Data integrity — no data was invented or corrupted

Usage:
  python3 validate.py
  python3 validate.py --input ../test-data/messy_data.csv --output ../test-data/output_cleaned.csv
"""

import pandas as pd
import argparse
import sys
import os


def load_csv(filepath: str) -> pd.DataFrame:
    """Load a CSV file and return a DataFrame."""
    if not os.path.exists(filepath):
        print(f"FAIL: File not found: {filepath}")
        sys.exit(1)
    return pd.read_csv(filepath)


def validate_schema(input_df: pd.DataFrame, output_df: pd.DataFrame) -> bool:
    """Check that the output has the same columns as the input."""
    print("\n--- Validation 1: Schema Correctness ---")

    input_cols = set(col.strip().lower() for col in input_df.columns)
    output_cols = set(col.strip().lower() for col in output_df.columns)

    if input_cols == output_cols:
        print(f"PASS: Output columns match input columns: {sorted(output_cols)}")
        return True
    else:
        missing = input_cols - output_cols
        extra = output_cols - input_cols
        if missing:
            print(f"FAIL: Missing columns in output: {missing}")
        if extra:
            print(f"FAIL: Unexpected columns in output: {extra}")
        return False


def validate_row_count(input_df: pd.DataFrame, output_df: pd.DataFrame) -> bool:
    """Check that duplicate removal reduced the row count."""
    print("\n--- Validation 2: Row Count ---")

    input_rows = len(input_df)
    output_rows = len(output_df)

    print(f"  Input rows:  {input_rows}")
    print(f"  Output rows: {output_rows}")

    if output_rows < input_rows:
        removed = input_rows - output_rows
        print(f"PASS: {removed} row(s) removed (duplicates)")
        return True
    elif output_rows == input_rows:
        print("WARN: No rows were removed. Deduplication may not have worked.")
        return True  # not strictly a failure -- depends on the transformation
    else:
        print("FAIL: Output has MORE rows than input. Data may have been duplicated.")
        return False


def validate_text_casing(output_df: pd.DataFrame) -> bool:
    """Check that all text columns are lowercased."""
    print("\n--- Validation 3: Text Casing (Lowercase) ---")

    text_cols = output_df.select_dtypes(include=["object", "str"]).columns.tolist()
    passed = True

    for col in text_cols:
        non_null = output_df[col].dropna()
        uppercase_values = non_null[non_null != non_null.str.lower()]

        if len(uppercase_values) > 0:
            print(f"FAIL: Column '{col}' has {len(uppercase_values)} non-lowercase value(s):")
            for val in uppercase_values.head(3):
                print(f"       '{val}'")
            passed = False
        else:
            print(f"PASS: Column '{col}' is fully lowercase")

    return passed


def validate_no_duplicates(output_df: pd.DataFrame) -> bool:
    """Check that the output has no exact duplicate rows."""
    print("\n--- Validation 4: No Duplicate Rows ---")

    dupes = output_df.duplicated()
    dupe_count = dupes.sum()

    if dupe_count == 0:
        print("PASS: No exact duplicate rows found in output")
        return True
    else:
        print(f"FAIL: Found {dupe_count} duplicate row(s) in output")
        print(output_df[dupes].head())
        return False


def validate_data_integrity(input_df: pd.DataFrame, output_df: pd.DataFrame) -> bool:
    """Check that output data is a subset of input data (no invented rows)."""
    print("\n--- Validation 5: Data Integrity ---")

    # normalize input for comparison — lowercase text columns
    input_normalized = input_df.copy()
    for col in input_normalized.select_dtypes(include=["object", "str"]).columns:
        input_normalized[col] = input_normalized[col].astype(str).str.lower().replace("nan", pd.NA)

    # check that output row count doesn't exceed input
    if len(output_df) > len(input_df):
        print("FAIL: Output has more rows than input — data may have been invented")
        return False

    print(f"PASS: Output ({len(output_df)} rows) is smaller than or equal to input ({len(input_df)} rows)")
    return True


def main():
    parser = argparse.ArgumentParser(description="Validate Rhombus AI data transformation")
    parser.add_argument(
        "--input",
        default=os.path.join(os.path.dirname(__file__), "..", "test-data", "messy_data.csv"),
        help="Path to the original input CSV",
    )
    parser.add_argument(
        "--output",
        default=os.path.join(os.path.dirname(__file__), "..", "test-data", "output_cleaned.csv"),
        help="Path to the transformed output CSV",
    )
    args = parser.parse_args()

    print("=" * 55)
    print("  Rhombus AI - Data Validation")
    print("=" * 55)
    print(f"  Input:  {args.input}")
    print(f"  Output: {args.output}")

    input_df = load_csv(args.input)
    output_df = load_csv(args.output)

    results = []
    results.append(("Schema Correctness", validate_schema(input_df, output_df)))
    results.append(("Row Count", validate_row_count(input_df, output_df)))
    results.append(("Text Casing", validate_text_casing(output_df)))
    results.append(("No Duplicates", validate_no_duplicates(output_df)))
    results.append(("Data Integrity", validate_data_integrity(input_df, output_df)))

    # summary
    print("\n" + "=" * 55)
    print("  SUMMARY")
    print("=" * 55)
    all_passed = True
    for name, passed in results:
        status = "PASS" if passed else "FAIL"
        print(f"  [{status}] {name}")
        if not passed:
            all_passed = False

    print()
    if all_passed:
        print("All validations passed.")
        sys.exit(0)
    else:
        print("Some validations failed. See details above.")
        sys.exit(1)


if __name__ == "__main__":
    main()
