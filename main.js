
import * as THREE from 'three';
import { OrbitControls } from './libs/OrbitControls.js';
import * as CANNON from './libs/cannon-es.js';

/**
 * @typedef {Object} WorldObject
 * @property {THREE.Mesh} mesh
 * @property {CANNON.Body} body
 * @property {string} type
 * @property {Map<WorldObject, CANNON.Constraint>} [stuckObjects]
 * @property {number} objectId
 */

let scene, camera, renderer, world, controls, raycaster, mouse;
let timeStep = 1 / 60;
let objectIdCounter = 1;
/** @type {WorldObject[]} */
let objects = [];
let counts = {
	rice: 0,
	nori: 0,
	fish: 0,
	bamboo: 0,
};
let currentMode = 'interact-move';
/** @type {WorldObject[]} */
let heldObjects = [];
let rotatingDir = 0;
/** @type {WorldObject[]} */
let highlightedObjects = [];
let groundPlane;
/** @type {THREE.Vector3[]} */
let dragOffsets = [];
let debugVisualizationEnabled = document.getElementById('debug-toggle').checked;
let constraintBreakThreshold = parseFloat(document.getElementById('constraint-threshold').value);
let riceSize = parseFloat(document.getElementById('rice-size').value);
let liftHeight = parseFloat(document.getElementById('lift-height').value);
let liftDuration = parseFloat(document.getElementById('lift-time').value);
let liftFraction = 0; // for animating lift
let rotationSpeed = 0.05;
const keys = {};

const RICE_GRAB_RADIUS = 0.2;
const RICE_DELETION_RADIUS = 0.3;

function init() {
	scene = new THREE.Scene();
	camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
	renderer = new THREE.WebGLRenderer({ antialias: true });
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	document.getElementById('scene-container').appendChild(renderer.domElement);

	const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
	scene.add(ambientLight);
	const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
	directionalLight.position.set(10, 20, 10);
	directionalLight.castShadow = true;
	scene.add(directionalLight);

	camera.position.set(0, 2, 3);
	camera.lookAt(0, 0, 0);

	controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.05;

	raycaster = new THREE.Raycaster();
	mouse = new THREE.Vector2();

	world = new CANNON.World();
	world.gravity.set(0, -9.82, 0);

	const groundShape = new CANNON.Plane();
	const groundBody = new CANNON.Body({ mass: 0 });
	groundBody.addShape(groundShape);
	groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
	world.addBody(groundBody);

	const groundSize = 1000;
	const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize);
	const groundMaterial = new THREE.MeshStandardMaterial({ color: 0xd2b48c });
	const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
	groundMesh.rotation.x = -Math.PI / 2;
	groundMesh.name = 'ground';
	groundMesh.receiveShadow = true;
	scene.add(groundMesh);

	groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

	// I'm tired, and I'm working within a bad framework decided by the AI
	let justClosed = [];
	document.addEventListener('pointerdown', (e) => {
		if (e.target?.closest('.flyout')) return; // allow clicking within the flyout
		justClosed = [...document.querySelectorAll('.flyout.active')];
		document.querySelectorAll('.flyout').forEach(flyout => flyout.classList.remove('active'));
	});
	document.addEventListener('pointerup', (e) => {
		// pointerup comes before click, hence the timeout
		setTimeout(() => { justClosed = []; }, 0);
	});
	document.getElementById('settings-menu').addEventListener('click', (e) => {
		if (justClosed.some(flyout => flyout === document.getElementById('settings-flyout'))) return; // allow toggling the flyout closed (but for other menus, open immediately)
		if (e.target?.closest('#settings-flyout')) return; // because the stupid flyout is within the button
		document.getElementById('settings-flyout').classList.toggle('active');
	});
	document.getElementById('add-menu').addEventListener('click', (e) => {
		if (justClosed.some(flyout => flyout === document.getElementById('add-flyout'))) return; // allow toggling the flyout closed (but for other menus, open immediately)
		if (e.target?.closest('#add-flyout')) return; // because the stupid flyout is within the button
		document.getElementById('add-flyout').classList.toggle('active');
	});

	document.getElementById('add-rice').addEventListener('click', addRiceBatch);
	document.getElementById('add-nori').addEventListener('click', addNori);
	document.getElementById('add-fish').addEventListener('click', addFish);
	document.getElementById('add-bamboo').addEventListener('click', addBambooMat);

	document.querySelectorAll('.toolbar-button').forEach(button => {
		button.addEventListener('click', (e) => {
			setMode(e.currentTarget.id);
		});
	});

	document.getElementById('debug-toggle').addEventListener('change', (e) => {
		debugVisualizationEnabled = e.target.checked;
	});

	document.getElementById('constraint-threshold').addEventListener('input', (e) => {
		constraintBreakThreshold = parseFloat(e.target.value);
	});

	document.getElementById('rice-size').addEventListener('input', (e) => {
		riceSize = parseFloat(e.target.value);
	});

	document.getElementById('lift-height').addEventListener('input', (e) => {
		liftHeight = parseFloat(e.target.value);
	});

	document.getElementById('lift-time').addEventListener('input', (e) => {
		liftDuration = parseFloat(e.target.value);
	});

	renderer.domElement.addEventListener('pointerdown', onPointerDown);
	renderer.domElement.addEventListener('pointermove', onPointerMove);
	renderer.domElement.addEventListener('pointerup', onPointerUp);
	renderer.domElement.addEventListener('pointercancel', onPointerUp);

	// TODO: maybe handle mousewheel for rotation (could also be used for lifting, alternatively...)
	document.addEventListener('keydown', (e) => {
		keys[e.code] = true;
	});
	document.addEventListener('keyup', (e) => {
		keys[e.code] = false;
	});

	// AAAAAAAAAAAAAAAA
	// Why is it so hard to implement a continuous effect for a button???

	let pointerIdForRotation = null;
	document.getElementById('rotate-left').addEventListener('pointerdown', (e) => {
		pointerIdForRotation = e.pointerId;
		rotatingDir = -1;
	});
	document.getElementById('rotate-right').addEventListener('pointerdown', (e) => {
		pointerIdForRotation = e.pointerId;
		rotatingDir = 1;
	});

	document.getElementById('rotate-left').addEventListener('pointerenter', (e) => {
		if (e.pointerId === pointerIdForRotation) {
			rotatingDir = -1
		};
	});
	document.getElementById('rotate-right').addEventListener('pointerenter', (e) => {
		if (e.pointerId === pointerIdForRotation) {
			rotatingDir = 1;
		}
	});

	// pointerleave and pointerout aren't happening until the pointer is released for some reason
	// (do buttons implicitly capture the pointer?? well it doesn't work even if I make them not buttons... some weird multitouch thing I guess!)

	document.getElementById('rotate-left').addEventListener('pointerleave', (e) => {
		// console.log(`e.pointerId: ${e.pointerId}, pointerIdForRotation: ${pointerIdForRotation}`);
		if (e.pointerId === pointerIdForRotation) {
			rotatingDir = 0;
		}
	});
	document.getElementById('rotate-right').addEventListener('pointerleave', (e) => {
		if (e.pointerId === pointerIdForRotation) {
			rotatingDir = 0;
		}
	});

	// so I have to use pointermove to detect leaving the button :(
	// still need the above pointerleave or pointerout for when the pointer is released
	document.addEventListener('pointermove', (e) => {
		// console.log(`pointermove, e.pointerId: ${e.pointerId}, pointerIdForRotation: ${pointerIdForRotation}`);
		// console.log(`e.target.className: ${e.target.className}`);
		// e.target also doesn't work, it stays as the button when pointer is outside the button
		const theElement = document.elementFromPoint(e.clientX, e.clientY);
		if (e.pointerId === pointerIdForRotation) {
			const leftButton = document.getElementById('rotate-left');
			const rightButton = document.getElementById('rotate-right');
			// if (!leftButton.contains(theElement) && !rightButton.contains(theElement)) {
			// 	rotatingDir = 0;
			// }
			rotatingDir = leftButton.contains(theElement) ? -1 : rightButton.contains(theElement) ? 1 : 0;
		}
	});

	// /AAAAAAAAAAAAAAAA

	setMode('interact-move');
	animate();

	// Add initial objects
	addBambooMat();
	addNori();
	addFish();
	addRiceBatch();
}

function rotateHeldObjects(angle) {
	if (heldObjects.length > 0) {
		const center = new THREE.Vector3();
		heldObjects.forEach(obj => center.add(obj.mesh.position));
		center.divideScalar(heldObjects.length);

		const rotationAxis = new THREE.Vector3(0, 1, 0);
		const rotationQuaternion = new THREE.Quaternion().setFromAxisAngle(rotationAxis, angle);

		heldObjects.forEach(obj => {
			const localPos = obj.mesh.position.clone().sub(center);
			localPos.applyQuaternion(rotationQuaternion);

			obj.mesh.position.copy(localPos.add(center));
			obj.mesh.quaternion.premultiply(rotationQuaternion);

			// Update physics body
			obj.body.position.copy(obj.mesh.position);
			obj.body.quaternion.copy(obj.mesh.quaternion);
		});
		// Update drag offsets
		dragOffsets.forEach(offset => offset.applyQuaternion(rotationQuaternion));
	}
}

function handleRiceCollision(event) {
	const contact = event.contact;
	const bodyA = contact.bi;
	const bodyB = contact.bj;

	const objectA = objects.find(object => object.body === bodyA);
	const objectB = objects.find(object => object.body === bodyB);

	if (objectA && objectB) {
		if (objectA.type !== 'rice') {
			console.error('contact.bi doesn\'t correspond to a rice grain');
		}
		const riceObject = objectA;
		const otherObject = objectB;

		if (!riceObject.stuckObjects) {
			riceObject.stuckObjects = new Map();
		}

		if (!riceObject.stuckObjects.has(otherObject) && riceObject.stuckObjects.size < 8) {
			const constraint = new CANNON.LockConstraint(riceObject.body, otherObject.body, {
				// TODO: tune this value, may be ridiculously high
				// The AI decided on this when first using LockConstraint in https://github.com/1j01/makisu/commit/6b6f0876b569b9a4c175901914c1672aedd37ac9
				maxForce: 1e6,
			});
			world.addConstraint(constraint);
			riceObject.stuckObjects.set(otherObject, constraint);
		}
	}
}

function setMode(mode) {
	currentMode = mode;
	document.querySelectorAll('.toolbar-button').forEach(button => {
		button.classList.remove('active');
	});
	document.getElementById(mode).classList.add('active');

	updateCursor();

	controls.enableRotate = true;
	controls.enablePan = true;
	controls.enableZoom = true;

	controls.mouseButtons = {
		LEFT: THREE.MOUSE.ROTATE,
		MIDDLE: THREE.MOUSE.ROTATE,
		RIGHT: THREE.MOUSE.PAN
	};

	controls.touches = {
		ONE: THREE.TOUCH.ROTATE,
		TWO: THREE.TOUCH.DOLLY_PAN,
	};

	if (mode === 'camera-pan') {
		controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
		controls.touches.ONE = THREE.TOUCH.PAN;
	} else if (mode === 'camera-zoom') {
		controls.mouseButtons.LEFT = THREE.MOUSE.DOLLY;
		controls.touches.ONE = null; // there is no THREE.TOUCH.DOLLY, and DOLLY_PAN is not handled for a single touch
		// for now, you just have to use multitouch to zoom, and this tool isn't technically useful,
		// since you can do it with other tools selected
	} else if (mode === 'interact-move' || mode === 'interact-pinch' || mode === 'interact-delete') {
		controls.mouseButtons.LEFT = null;
		controls.touches.ONE = null;
	}
}

function updateHover(event) {
	const rect = renderer.domElement.getBoundingClientRect();
	mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
	mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
	raycaster.setFromCamera(mouse, camera);

	for (const highlightedObject of highlightedObjects) {
		// TODO: maybe avoid unnecessary calls to setHex? not sure if it's expensive
		highlightedObject.mesh.material.emissive.setHex(0x000000);
	}
	if (heldObjects.length === 0) {
		highlightedObjects = [];

		const intersects = raycaster.intersectObjects(objects.map(item => item.mesh));
		if (intersects.length > 0 && (currentMode === 'interact-move' || currentMode === 'interact-pinch' || currentMode === 'interact-delete')) {
			const hoveredObject = objects.find(item => item.mesh === intersects[0].object);

			if (currentMode === 'interact-move' || currentMode === 'interact-delete') {
				if (hoveredObject.type === 'rice') {
					// Target all rice grains within the appropriate radius
					const riceSearchRadius = currentMode === 'interact-delete' ? RICE_DELETION_RADIUS : RICE_GRAB_RADIUS;
					objects.forEach(object => {
						if (object.type === 'rice' && object.mesh.position.distanceTo(hoveredObject.mesh.position) <= riceSearchRadius) {
							highlightedObjects.push(object);
						}
					});
				} else {
					// For other object types, target all parts of the specific logical object
					const objectId = hoveredObject.objectId;
					objects.forEach(object => {
						if (object.objectId === objectId) {
							highlightedObjects.push(object);
						}
					});
				}
			} else if (currentMode === 'interact-pinch') {
				// Target only the clicked object
				highlightedObjects.push(hoveredObject);
			}
		}
	}
	for (const highlightedObject of highlightedObjects) {
		highlightedObject.mesh.material.emissive.setHex(currentMode === 'interact-delete' ? 0xff0000 : 0x444444);
	}
	updateCursor();
}

function updateCursor() {
	switch (currentMode) {
		case 'camera-rotate':
			renderer.domElement.style.cursor = 'default';
			break;
		case 'camera-pan':
			renderer.domElement.style.cursor = 'move';
			break;
		case 'camera-zoom':
			renderer.domElement.style.cursor = 'zoom-in';
			break;
		case 'interact-move':
			renderer.domElement.style.cursor = heldObjects.length ? 'grabbing' : (highlightedObjects.length ? 'grab' : 'default');
			break;
		case 'interact-pinch':
			renderer.domElement.style.cursor = heldObjects.length ? 'grabbing' : (highlightedObjects.length ? 'grab' : 'default');
			break;
		case 'interact-delete':
			renderer.domElement.style.cursor = highlightedObjects.length ? 'crosshair' : 'default';
			break;
	}
}

function onPointerDown(event) {
	event.preventDefault();
	updateHover(event);

	if (highlightedObjects.length > 0) {
		if (currentMode === 'interact-move' || currentMode === 'interact-pinch') {
			heldObjects = highlightedObjects.slice();

			if (heldObjects[0].type === 'rice') {
				// Break connections between the dragged rice and other objects
				// TODO: prevent connections from re-forming while dragging
				heldObjects.forEach(rice => {
					if (rice.stuckObjects) {
						rice.stuckObjects.forEach((constraint, otherObject) => {
							if (!heldObjects.includes(otherObject)) {
								world.removeConstraint(constraint);
								rice.stuckObjects.delete(otherObject);
							}
						});
					}
				});
			}

			controls.enabled = false;

			// Store the initial offsets for all grabbed objects
			const intersection = new THREE.Vector3();
			raycaster.ray.intersectPlane(groundPlane, intersection);
			dragOffsets = heldObjects.map(object => {
				const offset = new THREE.Vector3().subVectors(object.mesh.position, intersection);
				return offset;
			});

			// Show rotate buttons for touch devices
			if ('ontouchstart' in window) {
				document.getElementById('toolbar').style.display = 'none';
				document.getElementById('rotate-buttons').style.display = '';
			}
		} else if (currentMode === 'interact-delete') {
			deleteObjects(highlightedObjects);
		}
	}
	// Cursor may change from starting a drag or deleting objects after `updateHover` above
	updateCursor();
}

function deleteObjects(objectsToDelete) {
	// Ugly, I wouldn't do it like this from first principles,
	// I'm just fixing the AI's counting bug
	// It would probably be better to count everything from the current state every time (when adding and removing)
	// Could improve this a bit by defining the group types in one place though
	const isGroup = ["nori", "bamboo"].includes(objectsToDelete[0].type);
	objectsToDelete.forEach(object => {
		scene.remove(object.mesh);
		world.removeBody(object.body);
		if (!isGroup) {
			updateObjectCounter(object.type, -1);
		}
	});
	if (isGroup) {
		updateObjectCounter(objectsToDelete[0].type, -1);
	}
	objects = objects.filter(object => !objectsToDelete.includes(object));
}

function onPointerMove(event) {
	updateHover(event);
}

function onPointerUp(event) {
	rotatingDir = 0;
	heldObjects = [];
	dragOffsets = [];
	controls.enabled = true;
	updateCursor();

	// Hide rotate buttons and show toolbar for touch devices
	document.getElementById('toolbar').style.display = '';
	document.getElementById('rotate-buttons').style.display = 'none';
}


function addRiceBatch() {
	for (let i = 0; i < 100; i++) {
		setTimeout(() => addRice(), i * 10);
	}
}

function addRice() {
	const riceGeometry = new THREE.SphereGeometry(riceSize, 8, 8);
	const riceMaterial = new THREE.MeshStandardMaterial({ color: 0xfffaf0 });
	const riceMesh = new THREE.Mesh(riceGeometry, riceMaterial);
	riceMesh.userData.type = 'rice';
	riceMesh.castShadow = true;
	riceMesh.receiveShadow = true;

	const riceShape = new CANNON.Sphere(riceSize);
	const riceBody = new CANNON.Body({
		mass: 0.01,
		shape: riceShape,
		position: new CANNON.Vec3(Math.random() * 2 - 1, 5 + Math.random() * 2, Math.random() * 2 - 1)
	});

	riceBody.material = new CANNON.Material({ friction: 0.5, restitution: 0.1 });

	riceBody.addEventListener("collide", handleRiceCollision);

	scene.add(riceMesh);
	world.addBody(riceBody);
	objects.push({ mesh: riceMesh, body: riceBody, type: 'rice', stuckObjects: new Map(), objectId: objectIdCounter++ });

	updateObjectCounter('rice', 1);
}

function addNori() {
	const noriWidth = 1;
	const noriHeight = 0.01;
	const noriDepth = 1;
	const segments = 10;
	const objectId = objectIdCounter++;

	for (let i = 0; i < segments; i++) {
		const segmentWidth = noriWidth / segments;
		const segmentGeometry = new THREE.BoxGeometry(segmentWidth, noriHeight, noriDepth);
		const noriMaterial = new THREE.MeshStandardMaterial({ color: 0x1a4c1a });
		const noriMesh = new THREE.Mesh(segmentGeometry, noriMaterial);
		noriMesh.userData.type = 'nori';
		noriMesh.castShadow = true;
		noriMesh.receiveShadow = true;

		const noriShape = new CANNON.Box(new CANNON.Vec3(segmentWidth / 2, noriHeight / 2, noriDepth / 2));
		const noriBody = new CANNON.Body({
			mass: 0.05,
			shape: noriShape,
			position: new CANNON.Vec3((i - segments / 2) * segmentWidth, 5, Math.random() * 2 - 1)
		});

		if (i > 0) {
			const constraint = new CANNON.HingeConstraint(
				objects[objects.length - 1].body,
				noriBody,
				{
					pivotA: new CANNON.Vec3(segmentWidth / 2, 0, 0),
					pivotB: new CANNON.Vec3(-segmentWidth / 2, 0, 0),
					axisA: new CANNON.Vec3(0, 0, 1),
					axisB: new CANNON.Vec3(0, 0, 1)
				}
			);
			world.addConstraint(constraint);
		}

		scene.add(noriMesh);
		world.addBody(noriBody);
		objects.push({ mesh: noriMesh, body: noriBody, type: 'nori', objectId });
	}

	updateObjectCounter('nori', 1);
}

function addFish() {
	const fishGeometry = new THREE.BoxGeometry(0.4, 0.1, 0.2);
	const fishMaterial = new THREE.MeshStandardMaterial({ color: 0xfa8072 });
	const fishMesh = new THREE.Mesh(fishGeometry, fishMaterial);
	fishMesh.userData.type = 'fish';
	fishMesh.castShadow = true;
	fishMesh.receiveShadow = true;

	const fishShape = new CANNON.Box(new CANNON.Vec3(0.2, 0.05, 0.1));
	const fishBody = new CANNON.Body({
		mass: 0.3,
		shape: fishShape,
		position: new CANNON.Vec3(Math.random() * 2 - 1, 5, Math.random() * 2 - 1)
	});

	scene.add(fishMesh);
	world.addBody(fishBody);
	objects.push({ mesh: fishMesh, body: fishBody, type: 'fish', objectId: objectIdCounter++ });

	updateObjectCounter('fish', 1);
}

function addBambooMat() {
	const matWidth = 1.5;
	const matHeight = 0.01;
	const matDepth = 1;
	const segments = 15;
	const objectId = objectIdCounter++;

	for (let i = 0; i < segments; i++) {
		const segmentWidth = matWidth / segments;
		const segmentGeometry = new THREE.BoxGeometry(segmentWidth, matHeight, matDepth);
		const bambooMaterial = new THREE.MeshStandardMaterial({ color: 0x90EE90 }); // Light green color
		const bambooMesh = new THREE.Mesh(segmentGeometry, bambooMaterial);
		bambooMesh.userData.type = 'bamboo';
		bambooMesh.castShadow = true;
		bambooMesh.receiveShadow = true;

		const bambooShape = new CANNON.Box(new CANNON.Vec3(segmentWidth / 2, matHeight / 2, matDepth / 2));
		const bambooBody = new CANNON.Body({
			mass: 0.05,
			shape: bambooShape,
			position: new CANNON.Vec3((i - segments / 2) * segmentWidth, 5, Math.random() * 2 - 1)
		});

		if (i > 0) {
			const constraint = new CANNON.HingeConstraint(
				objects[objects.length - 1].body,
				bambooBody,
				{
					pivotA: new CANNON.Vec3(segmentWidth / 2, 0, 0),
					pivotB: new CANNON.Vec3(-segmentWidth / 2, 0, 0),
					axisA: new CANNON.Vec3(0, 0, 1),
					axisB: new CANNON.Vec3(0, 0, 1)
				}
			);
			world.addConstraint(constraint);
		}

		scene.add(bambooMesh);
		world.addBody(bambooBody);
		objects.push({ mesh: bambooMesh, body: bambooBody, type: 'bamboo', objectId });
	}

	updateObjectCounter('bamboo', 1);
}

function updateObjectCounter(type, change) {
	counts[type] += change;
	document.getElementById(type + '-count').textContent = counts[type];
}

function animate() {
	requestAnimationFrame(animate);
	world.step(timeStep);

	objects.forEach(object => {
		object.mesh.position.copy(object.body.position);
		object.mesh.quaternion.copy(object.body.quaternion);

		// Check and break constraints if necessary
		if (object.stuckObjects) {
			for (let [otherObject, constraint] of object.stuckObjects.entries()) {
				if (constraint.equations[0].multiplier > constraintBreakThreshold) {
					world.removeConstraint(constraint);
					object.stuckObjects.delete(otherObject);
				}
			}
		}
	});

	if (heldObjects.length > 0) {

		liftFraction += timeStep / liftDuration;
		liftFraction = Math.min(liftFraction, 1);

		const realRotatingDir = Math.sign(rotatingDir + ((keys['ArrowLeft'] || keys['KeyQ']) ? -1 : 0) + ((keys['ArrowRight'] || keys['KeyE']) ? 1 : 0)); // shush! it's fine!
		rotateHeldObjects(realRotatingDir * rotationSpeed);

		const intersection = new THREE.Vector3();
		raycaster.ray.intersectPlane(groundPlane, intersection);

		heldObjects.forEach((object, index) => {
			const targetPosition = new THREE.Vector3().addVectors(intersection, dragOffsets[index]);
			targetPosition.y += liftHeight * liftFraction;
			object.mesh.position.copy(targetPosition);
			object.body.position.copy(targetPosition);
			object.body.velocity.set(0, 0, 0);
			object.body.angularVelocity.set(0, 0, 0);
		});
	} else {
		liftFraction = 0;
	}

	controls.update();
	renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
});

init();
