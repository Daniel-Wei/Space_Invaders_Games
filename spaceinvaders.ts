import { fromEvent, interval, merge } from 'rxjs';
import { map, filter, scan } from 'rxjs/operators';

// Event Classes
class Tick {
  constructor(public readonly elapsed: number) {}
}
class Move {
  constructor(public readonly vel: number) {}
}
class Shoot {
  constructor() {}
}
class Restart {
  constructor() {}
}

// User Input Key Types
type Key = 'ArrowLeft' | 'ArrowRight' | 'Space' | 'Enter';

type State = Readonly<{
  ship: Body;
  shipBullets: ReadonlyArray<Body>;
  exit: ReadonlyArray<Body>;
  objCount: number;
  aliens: ReadonlyArray<Body>;
  alienBullet: ReadonlyArray<Body>;
  gameOver: boolean;
  score: number;
  shield: ReadonlyArray<Body>;
}>;

type Body = Readonly<{
  viewType: string;
  id: string;
  x: number;
  y: number;
  vel?: number;
  radius?: number;
}>;

// Objs Types
type ViewType = 'ship' | 'alien' | 'shipBullet' | 'alienBullet' | 'shield';

// Constants
const Constants = {
  initialAlienNum: 15,
  initialShieldNum: 40,
  canvasSize: 600,
  shipRadius: 15,
  alienRadius: 20,
  shieldRadius: 10,
  alienBulletRadius: 5,
  shipBulletRadius: 7,
  scorePerAlien: 10,
  alienShootInterval: 80,
  alienMoveInterval: 7,
  shipBulletMovement: 8,
  alienBulletMovement: 2,
  alienSpeedUp: 6
} as const;

/**
 * Create bodies according to their viewTypes
 */
const createBody = (viewType: ViewType) => (x: number) => (y: number) => (
  id: number
) =>
  viewType == 'alien'
    ? <Body>{
        viewType: viewType,
        id: viewType + id,
        x: x * 100 + 20,
        y: 100 + y,
        vel: -1,
        radius: Constants.alienRadius
      }
    : viewType == 'shield'
    ? <Body>{
        viewType: viewType,
        id: viewType + id,
        x: x * 120 + (id % 5) * Constants.initialAlienNum + 100,
        y: 480 - y,
        radius: Constants.shieldRadius
      }
    : viewType == 'ship'
    ? <Body>{
        viewType: viewType,
        id: viewType + id,
        x: x,
        y: y,
        vel: 0,
        radius: Constants.shipRadius
      }
    : viewType == 'alienBullet'
    ? <Body>{
        viewType: viewType,
        id: viewType + id,
        x: x,
        y: y,
        radius: Constants.alienBulletRadius
      }
    : {
        viewType: viewType,
        id: viewType + id,
        x: x,
        y: y,
        radius: Constants.shipBulletRadius
      };

/**
 * Move bodies according to their viewTypes
 */
const moveBody = (body: Body) => {
  const viewType = body.viewType;
  return viewType == 'shipBullet'
    ? {
        ...body,
        y: body.y - Constants.shipBulletMovement
      }
    : viewType == 'alienBullet'
    ? {
        ...body,
        y: body.y + Constants.alienBulletMovement
      }
    : // make ship could appear at the other side when go beyond left/right side of the canvas 
      {
        ...body,
        x:
          body.x + body.vel < 0
            ? Constants.canvasSize
            : body.x + body.vel > Constants.canvasSize
            ? 0
            : body.x + body.vel
      };
};

// four clusters of initial shields
const initialShields = [...Array(Constants.initialShieldNum)].map((_, i) =>
  i >= 0 && i <= 20
    ? createBody('shield')(i % 4)(0)(i)
    : createBody('shield')(i % 4)(10)(i)
);

// three rows of initial aliens
const initialAliens = [...Array(Constants.initialAlienNum)].map((_, i) =>
  i <= 5
    ? createBody('alien')(i % 5)(0)(i)
    : i <= 10
    ? createBody('alien')(i % 5)(50)(i)
    : createBody('alien')(i % 5)(100)(i)
);

// initial state
const initialState: State = {
  ship: createBody('ship')(Constants.canvasSize / 2)(Constants.canvasSize - 50)(
    0
  ),
  shipBullets: [],
  exit: [],
  objCount: Constants.initialAlienNum,
  aliens: initialAliens,
  alienBullet: [],
  gameOver: false,
  score: 0,
  shield: initialShields
};

/**
 * Update State
 */

const reduceState = (s: State, e: Move | Shoot | Tick | Restart) => {
  // faster: when level up, makes aliens move faster
  // toBeRemoved: when restart,makes all previous objects be removed
  const faster = (alien: Body) => <Body>{ ...alien, vel: alien.vel * Constants.alienSpeedUp},
    toBeRemoved = (s.aliens, s.shield, s.alienBullet);

  // Move: move left or right according to user input
  return e instanceof Move
    ? {
        ...s,
        ship: { ...s.ship, vel: e.vel }
      }
    : // Shoot: When user shoot, create a new shipbullet based on current ship position
    e instanceof Shoot
    ? {
        ...s,
        shipBullets: s.shipBullets.concat([
          createBody('shipBullet')(s.ship.x)(s.ship.y)(s.objCount)
        ]),
        objCount: s.objCount + 1
      }
    : // Restart: when user restarts the game, set the state back to be the initial one and remove all current objects
    e instanceof Restart
    ? {
        ...initialState,
        exit: s.shipBullets.concat(toBeRemoved)
      }
    : // gameover: when game over, set state to be still
    s.gameOver
    ? s
    : // When no aliens, which means user levels up, set the state back to the initial one,
    // keep current score, remove all current objs and make new aliens move faster
    s.aliens.length == 0
    ? {
        ...initialState,
        aliens: initialState.aliens.map(faster),
        exit: s.shipBullets.concat(toBeRemoved),
        score: s.score
      }
    : // Otherwise, no events, just normal time ticking
      tick(s, e.elapsed);
};

/**
 * Handle all possible collisions
 */

const handleCollisions = (s: State): State => {
  // bodiesCollided: check whether two objs are too close
  // cut: remove same id objects
  const bodiesCollided = ([a, b]: [Body, Body]) =>
      calDist(a, b) < a.radius + b.radius,
    cut = except((a: Body) => (b: Body) => a.id === b.id),
    
    // ship bullets hit aliens
    allBulletsAndAliens = flatMap(s.shipBullets, b =>
      s.aliens.map<[Body, Body]>(r => [b, r])
    ),
    collidedBulletsAndAliens = allBulletsAndAliens.filter(bodiesCollided),
    collidedBullets = collidedBulletsAndAliens.map(
      ([shipBullet, _]) => shipBullet
    ),
    collidedAliens = collidedBulletsAndAliens.map(([_, alien]) => alien),
    
    // alien bullets hit shields
    allAlienBulletsAndShields = flatMap(s.alienBullet, b =>
      s.shield.map<[Body, Body]>(r => [b, r])
    ),
    collidedAlienBulletsAndShields = allAlienBulletsAndShields.filter(
      bodiesCollided
    ),
    collidedAlienBullets = collidedAlienBulletsAndShields.map(
      ([bullet, _]) => bullet
    ),
    collidedShields = collidedAlienBulletsAndShields.map(([_, rock]) => rock),
    
    // alien bullets hit ship
    collidedAlienBulletsWithShip = s.alienBullet.filter(r =>
      bodiesCollided([s.ship, r])
    ),
    
    // aliens reach the bottom of canvas
    aliensReachBottom =
      s.aliens.filter(({ y }) => y >= Constants.canvasSize).length > 0;

  // gameover: aliens' bullets already hit the ship or some aliens have reached the bottom of the canvas
  // all objs cut the collided ones
  // score: collided aliens * score per alien, as collided aliens are the ones hit by ship bullets
  return <State>{
    ...s,
    gameOver: collidedAlienBulletsWithShip.length > 0 || aliensReachBottom,
    shipBullets: cut(s.shipBullets)(collidedBullets),
    alienBullet: cut(s.alienBullet)(collidedAlienBullets),
    aliens: cut(s.aliens)(collidedAliens),
    shield: cut(s.shield)(collidedShields),
    exit: s.exit.concat(
      collidedShields,
      collidedAlienBullets,
      collidedAliens,
      collidedBullets
    ),
    score: s.score + collidedAliens.length * Constants.scorePerAlien
  };
};

/**
 * consistent tick: bodies move, bullets expire and discrete aliens fire and move
 */

const tick = (s: State, elapsed: number) => {
  const not = <T>(f: (x: T) => boolean) => (x: T) => !f(x);

  // Ship bullets expire when go beyond the top of the canvas
  const shipBulletExpires = (b: Body) => b.y <= 0,
    expiredShipBullets: Body[] = s.shipBullets.filter(shipBulletExpires),
    activeBullets = s.shipBullets.filter(not(shipBulletExpires));

  // alien bullets expire when go below the bottom of the canvas
  const alienBulletExpires = (b: Body) => b.y >= Constants.canvasSize,
    expiredAlienBullets: Body[] = s.alienBullet.filter(alienBulletExpires),
    activeAlienBullets = s.alienBullet.filter(not(alienBulletExpires));

  // noCollision: the state when all collisions have been resolved
  const noCollisions = handleCollisions({
    ...s,
    ship: moveBody(s.ship),
    shipBullets: activeBullets.map(moveBody),
    exit: expiredShipBullets.concat(expiredAlienBullets),
    alienBullet: activeAlienBullets.map(moveBody)
  });

  // get the random alien to fire
  const randomAlien = s.aliens[Math.floor(Math.random() * s.aliens.length)];

  // alienOffCanvas: the aliens have go beyond the left/right side of the canvas
  // alienDiscreteMove: make alien to move reversely in x direction and going down in y direction, reverse its vel as well
  // alienNormalMove: make alien keep moving in current movement pattern
  const alienOffCanvas = (s: State) =>
    s.aliens.filter(({ x }) => x < 0 || x >= Constants.canvasSize).length > 0;
  
  const alienDiscreteMove = (alien: Body) =>
    <Body>{
      ...alien,
      x: alien.x + -1 * alien.vel,
      y: alien.y + 20,
      vel: -1 * alien.vel
    };
  
  const alienNormalMove = (alien: Body) =>
    <Body>{ ...alien, x: alien.x + alien.vel, y: alien.y };

  // When time passsed for another interval for aliens to fire, create a new alien bullet based on a random alien position
  return elapsed % Constants.alienShootInterval == 0
    ? {
        ...noCollisions,
        alienBullet:
          s.aliens.length > 0
            ? s.alienBullet.concat([
                createBody('alienBullet')(randomAlien.x)(randomAlien.y)(
                  s.objCount
                )
              ])
            : s.alienBullet,
        objCount: s.objCount + 1
      }
    : // When time passed for another alien movement interval
    // if some aliens off canvas, make aliens do discrete moves
    // otherwise keep current movement pattern
    elapsed % Constants.alienMoveInterval == 0
    ? alienOffCanvas(s)
      ? {
          ...noCollisions,
          aliens: s.aliens.map(alienDiscreteMove)
        }
      : {
          ...noCollisions,
          aliens: s.aliens.map(alienNormalMove)
        }
    : noCollisions;
};

// the actual game engine
function spaceinvaders() {
  // Observables for user input events
  const startLeftMove = observeKey('keydown', 'ArrowLeft', () => new Move(-1)),
    stopLeftMove = observeKey('keyup', 'ArrowLeft', () => new Move(0)),
    startRightMove = observeKey('keydown', 'ArrowRight', () => new Move(1)),
    stopRightMove = observeKey('keyup', 'ArrowRight', () => new Move(0)),
    shoot = observeKey('keydown', 'Space', () => new Shoot()),
    restart = observeKey('keydown', 'Enter', () => new Restart());

  // Merge those observables together and let them keep updating state and views
  merge(
    interval(10).pipe(map(elapsed => new Tick(elapsed))),
    startLeftMove,
    stopLeftMove,
    startRightMove,
    stopRightMove,
    shoot,
    restart
  )
    .pipe(scan(reduceState, initialState))
    .subscribe(updateView);

  /**
   * Update all elements' views
   * @param s
   */
  function updateView(s: State) {
    const ship = document.getElementById('ship')!,
      svg = document.getElementById('svgCanvas')!,
      score = document.getElementById('score');

    // when game over, make the "gameOver" html element not be hidden anymore
    // otherwise, keep hidding it
    if (s.gameOver) {
      document.getElementById('gameOver').classList.remove('hidden');
    } else {
      document.getElementById('gameOver').classList.add('hidden');
    }

    // update score and transform ship position
    score.innerHTML = `Score: ${s.score}`;
    attr(ship, { transform: `translate(${s.ship.x},${s.ship.y})` });

    // all the following codes are referenced from the code for asteroids
    const updateBodyView = (b: Body) => {
      const filling = (viewType: ViewType) =>
        viewType === 'alien'
          ? 'green'
          : viewType == 'alienBullet'
          ? 'yellow'
          : viewType == 'shield'
          ? 'red'
          : 'lightBlue';

      function createBodyView() {
        const v = document.createElementNS(svg.namespaceURI, 'ellipse')!;
        attr(v, { id: b.id, rx: b.radius, ry: b.radius });
        v.setAttribute('fill', filling(<ViewType>b.viewType));
        v.classList.add(b.viewType);
        svg.appendChild(v);
        return v;
      }

      const v = document.getElementById(b.id) || createBodyView();
      attr(v, { cx: b.x, cy: b.y });
    };

    s.shipBullets.forEach(updateBodyView);
    s.aliens.forEach(updateBodyView);
    s.alienBullet.forEach(updateBodyView);
    s.shield.forEach(updateBodyView);

    s.exit
      .map(o => document.getElementById(o.id))
      .filter(isNotNullOrUndefined)
      .forEach(v => {
        try {
          svg.removeChild(v);
        } catch (e) {
          console.log('Already removed: ' + v.id);
        }
      });
  }
}

if (typeof window != 'undefined')
  window.onload = () => {
    spaceinvaders();
  };

/**
 * Util Functions
 * Ref: asteroids' code
 */

/**
 * Calculates the distance between 2 coordinates (x1,y1) and (x2, y2)
 */

function calDist(a: Body, b: Body): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// Document Functions
/**
 * apply f to every element of a and return the result in a flat array
 * @param a an array
 * @param f a function that produces an array
 */
function flatMap<T, U>(
  a: ReadonlyArray<T>,
  f: (a: T) => ReadonlyArray<U>
): ReadonlyArray<U> {
  return Array.prototype.concat(...a.map(f));
}

/**
 * array a except anything in b
 * @param eq equality test function for two Ts
 * @param a array to be filtered
 * @param b array of elements to be filtered out of a
 */

const except = <T>(eq: (_: T) => (_: T) => boolean) => (
  a: ReadonlyArray<T>
) => (b: ReadonlyArray<T>) => a.filter(not(elem(eq)(b)));

/**
 * Composable not: invert boolean result of given function
 * @param f a function returning boolean
 * @param x the value that will be tested with f
 */
const not = <T>(f: (x: T) => boolean) => (x: T) => !f(x);

/**
 * is e an element of a using the eq function to test equality?
 * @param eq equality test function for two Ts
 * @param a an array that will be searched
 * @param e an element to search a for
 */
const elem = <T>(eq: (_: T) => (_: T) => boolean) => (a: ReadonlyArray<T>) => (
  e: T
) => a.findIndex(eq(e)) >= 0;

/**
 * set a number of attributes on an Element at once
 * @param e the Element
 * @param o a property bag
 */

const attr = (e: Element, o: Object) => {
  for (const k in o) e.setAttribute(k, String(o[k]));
};

/**
 * Returns an observable that listens for events @param e of key  @param k.
 * This oversable is mapped to a stream of T objects (specified in @param resut)
 */

const observeKey = <T>(e: string, k: Key, result: () => T) =>
  fromEvent<KeyboardEvent>(document, e).pipe(
    filter(({ code }) => code === k),
    filter(({ repeat }) => !repeat),
    map(result)
  );

/**
 * Type guard for use in filters
 * @param input something that might be null or undefined
 */
function isNotNullOrUndefined<T extends Object>(
  input: null | undefined | T
): input is T {
  return input != null;
}