"""
Data processing utilities for ETL operations
Handles data cleaning, transformation, and validation
"""

import pandas as pd
import numpy as np
from typing import List, Dict, Any, Optional
from datetime import datetime
import re


class DataProcessor:
    """
    Main data processing class
    Provides methods for cleaning and transforming data frames
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """Initialize data processor with optional configuration"""
        self.config = config or {}
        self.missing_value_strategy = self.config.get('missing_values', 'drop')
        self.date_format = self.config.get('date_format', '%Y-%m-%d')

    def clean_dataframe(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Cleans a data frame by handling missing values, duplicates, and outliers

        Args:
            df: Input pandas DataFrame

        Returns:
            Cleaned DataFrame
        """
        # Remove duplicate rows
        df = df.drop_duplicates()

        # Handle missing values
        if self.missing_value_strategy == 'drop':
            df = df.dropna()
        elif self.missing_value_strategy == 'fill':
            df = self._fill_missing_values(df)

        # Remove outliers
        df = self._remove_outliers(df)

        return df

    def _fill_missing_values(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Fills missing values using appropriate strategies
        Numeric columns: mean, Categorical columns: mode
        """
        for column in df.columns:
            if df[column].dtype in [np.float64, np.int64]:
                # Fill numeric columns with mean
                df[column].fillna(df[column].mean(), inplace=True)
            else:
                # Fill categorical columns with mode
                df[column].fillna(df[column].mode()[0], inplace=True)

        return df

    def _remove_outliers(self, df: pd.DataFrame, threshold: float = 3.0) -> pd.DataFrame:
        """
        Removes outliers using z-score method

        Args:
            df: Input DataFrame
            threshold: Z-score threshold (default: 3.0)

        Returns:
            DataFrame with outliers removed
        """
        numeric_columns = df.select_dtypes(include=[np.number]).columns

        for column in numeric_columns:
            z_scores = np.abs((df[column] - df[column].mean()) / df[column].std())
            df = df[z_scores < threshold]

        return df

    def normalize_data(self, df: pd.DataFrame, columns: Optional[List[str]] = None) -> pd.DataFrame:
        """
        Normalizes numeric columns to 0-1 range

        Args:
            df: Input DataFrame
            columns: Columns to normalize (None = all numeric columns)

        Returns:
            DataFrame with normalized columns
        """
        if columns is None:
            columns = df.select_dtypes(include=[np.number]).columns.tolist()

        for column in columns:
            min_val = df[column].min()
            max_val = df[column].max()
            df[column] = (df[column] - min_val) / (max_val - min_val)

        return df

    def parse_dates(self, df: pd.DataFrame, date_columns: List[str]) -> pd.DataFrame:
        """
        Parses string columns to datetime objects

        Args:
            df: Input DataFrame
            date_columns: List of column names containing dates

        Returns:
            DataFrame with parsed date columns
        """
        for column in date_columns:
            if column in df.columns:
                df[column] = pd.to_datetime(df[column], format=self.date_format, errors='coerce')

        return df

    def validate_email_column(self, df: pd.DataFrame, column: str) -> pd.DataFrame:
        """
        Validates email addresses in a column and removes invalid entries

        Args:
            df: Input DataFrame
            column: Column name containing email addresses

        Returns:
            DataFrame with only valid email addresses
        """
        email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        df = df[df[column].str.match(email_pattern, na=False)]
        return df

    def aggregate_by_column(self, df: pd.DataFrame, group_column: str, agg_funcs: Dict[str, str]) -> pd.DataFrame:
        """
        Aggregates data by a grouping column

        Args:
            df: Input DataFrame
            group_column: Column to group by
            agg_funcs: Dictionary of column -> aggregation function

        Returns:
            Aggregated DataFrame
        """
        return df.groupby(group_column).agg(agg_funcs).reset_index()

    def create_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Creates derived features from existing columns
        For machine learning pipelines

        Returns:
            DataFrame with additional feature columns
        """
        # Create datetime features if datetime columns exist
        date_columns = df.select_dtypes(include=['datetime64']).columns

        for column in date_columns:
            df[f'{column}_year'] = df[column].dt.year
            df[f'{column}_month'] = df[column].dt.month
            df[f'{column}_day'] = df[column].dt.day
            df[f'{column}_dayofweek'] = df[column].dt.dayofweek

        return df


def calculate_statistics(data: pd.Series) -> Dict[str, float]:
    """
    Calculates comprehensive statistics for a data series

    Args:
        data: Pandas Series

    Returns:
        Dictionary of statistical measures
    """
    return {
        'mean': data.mean(),
        'median': data.median(),
        'std': data.std(),
        'min': data.min(),
        'max': data.max(),
        'q25': data.quantile(0.25),
        'q75': data.quantile(0.75),
        'count': data.count()
    }


def detect_anomalies(data: pd.Series, method: str = 'iqr') -> List[int]:
    """
    Detects anomalies in a data series using specified method

    Args:
        data: Pandas Series
        method: Detection method ('iqr' or 'zscore')

    Returns:
        List of indices where anomalies are detected
    """
    if method == 'iqr':
        q1 = data.quantile(0.25)
        q3 = data.quantile(0.75)
        iqr = q3 - q1
        lower_bound = q1 - 1.5 * iqr
        upper_bound = q3 + 1.5 * iqr
        anomalies = data[(data < lower_bound) | (data > upper_bound)]
    elif method == 'zscore':
        z_scores = np.abs((data - data.mean()) / data.std())
        anomalies = data[z_scores > 3]
    else:
        raise ValueError(f"Unknown method: {method}")

    return anomalies.index.tolist()
