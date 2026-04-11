import Cube from 'cubejs';
import { stateToFaceletString } from './cube-state.js';
import { parseMoveSequence } from './cube-moves.js';

let solverReady = false;
let initPromise = null;

// Initialize the solver (takes 2-5 seconds, precomputes lookup tables)
export function initSolver() {
  if (initPromise) return initPromise;
  initPromise = new Promise((resolve) => {
    // initSolver is synchronous but slow — run in a microtask to not block paint
    setTimeout(() => {
      Cube.initSolver();
      solverReady = true;
      resolve();
    }, 50);
  });
  return initPromise;
}

export function isSolverReady() {
  return solverReady;
}

// Solve the given cube state, returns array of move objects
export function solve(state) {
  if (!solverReady) throw new Error('Solver not initialized');

  const facelets = stateToFaceletString(state);
  const cube = Cube.fromString(facelets);
  const solution = cube.solve();

  if (!solution || solution.trim() === '') return [];
  return parseMoveSequence(solution);
}

// Get solution as a readable string
export function solveToString(state) {
  if (!solverReady) throw new Error('Solver not initialized');

  const facelets = stateToFaceletString(state);
  const cube = Cube.fromString(facelets);
  return cube.solve();
}
