import { databaseContract } from './helpers/contract';
import { memoryPostgres } from './helpers/pglite';

databaseContract('Work-item contract on embedded PostgreSQL (PGlite)', async () => memoryPostgres());
