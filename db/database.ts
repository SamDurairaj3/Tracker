/** Small SQL boundary shared by the repository, migrations, and tests. */
export interface Queryable {
  query<Row extends object = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>;
}

export interface Database extends Queryable {
  transaction<T>(
    operation: (client: Queryable) => Promise<T>,
    options?: { readOnly?: boolean },
  ): Promise<T>;
}
