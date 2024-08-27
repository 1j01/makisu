
import * as THREE from 'three';
import { OrbitControls } from './libs/OrbitControls.js';
import * as CANNON from './libs/cannon-es.js';

let scene, camera, renderer, world, controls, raycaster, mouse;
let timeStep = 1 / 60;
// TODO: change stupid "ingredient" terminology applying to all objects
// and "selected" should be "dragging"
let sushiIngredients = [];
let counts = {
	rice: 0,
	nori: 0,
	fish: 0,
	bamboo: 0,
};
let currentMode = 'interact-move';
let selectedObjects = [];
let isDragging = false;
let highlightedObjects = [];
let groundPlane;
let dragStartOffsets = [];
let constraintBreakThreshold = 1;
let debugVisualizationEnabled = document.getElementById('debug-toggle').checked;
let riceSize = parseFloat(document.getElementById('rice-size').value);
let liftHeight = parseFloat(document.getElementById('lift-height').value);
let liftDuration = parseFloat(document.getElementById('lift-time').value);
let liftFraction = 0; // for animating lift
let rotationSpeed = 0.05;

const RICE_SELECTION_RADIUS = 0.2;
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

	camera.position.set(0, 5, 10);
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
	// TODO: allow menu to open with one click while a DIFFERENT menu is open
	let justClosed = false;
	document.addEventListener('pointerdown', (e) => {
		if (e.target?.closest('.flyout')) return; // allow clicking within the flyout
		justClosed = document.querySelectorAll('.flyout.active').length > 0;
		document.querySelectorAll('.flyout').forEach(flyout => flyout.classList.remove('active'));
	});
	document.addEventListener('pointerup', (e) => {
		// pointerup comes before click, hence the timeout
		setTimeout(() => { justClosed = false; }, 0);
	});
	document.getElementById('settings-menu').addEventListener('click', (e) => {
		if (justClosed) return; // allow toggling the flyout closed
		if (e.target?.closest('#settings-flyout')) return; // because the stupid flyout is within the button
		document.getElementById('settings-flyout').classList.toggle('active');
	});
	document.getElementById('add-menu').addEventListener('click', (e) => {
		if (justClosed) return; // allow toggling the flyout closed
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

	document.addEventListener('keydown', (e) => {
		if (e.key === 'q' || e.key === 'Q') {
			rotateSelectedObjects(-rotationSpeed);
		} else if (e.key === 'e' || e.key === 'E') {
			rotateSelectedObjects(rotationSpeed);
		}
	});

	document.getElementById('rotate-left').addEventListener('pointerdown', (e) => {
		e.preventDefault();
		rotateSelectedObjects(-rotationSpeed);
	});

	document.getElementById('rotate-right').addEventListener('pointerdown', (e) => {
		e.preventDefault();
		rotateSelectedObjects(rotationSpeed);
	});

	setMode('interact-move');
	animate();
}

function rotateSelectedObjects(angle) {
	if (selectedObjects.length > 0) {
		const center = new THREE.Vector3();
		selectedObjects.forEach(obj => center.add(obj.mesh.position));
		center.divideScalar(selectedObjects.length);

		const rotationAxis = new THREE.Vector3(0, 1, 0);
		const rotationQuaternion = new THREE.Quaternion().setFromAxisAngle(rotationAxis, angle);

		selectedObjects.forEach(obj => {
			const localPos = obj.mesh.position.clone().sub(center);
			localPos.applyQuaternion(rotationQuaternion);

			obj.mesh.position.copy(localPos.add(center));
			obj.mesh.quaternion.premultiply(rotationQuaternion);

			// Update physics body
			obj.body.position.copy(obj.mesh.position);
			obj.body.quaternion.copy(obj.mesh.quaternion);
		});
		// Update drag offsets
		dragStartOffsets.forEach(offset => offset.applyQuaternion(rotationQuaternion));
	}
}

function handleCollision(event) {
	const contact = event.contact;
	const bodyA = contact.bi;
	const bodyB = contact.bj;

	const ingredientA = sushiIngredients.find(ingredient => ingredient.body === bodyA);
	const ingredientB = sushiIngredients.find(ingredient => ingredient.body === bodyB);

	if (ingredientA && ingredientB) {
		if (ingredientA.type === 'rice' || ingredientB.type === 'rice') {
			const riceIngredient = ingredientA.type === 'rice' ? ingredientA : ingredientB;
			const otherIngredient = riceIngredient === ingredientA ? ingredientB : ingredientA;

			if (!riceIngredient.stuckObjects) {
				riceIngredient.stuckObjects = new Map();
			}

			if (!riceIngredient.stuckObjects.has(otherIngredient) && riceIngredient.stuckObjects.size < 8) {
				const constraint = new CANNON.LockConstraint(riceIngredient.body, otherIngredient.body, {
					maxForce: 1e6
				});
				world.addConstraint(constraint);
				riceIngredient.stuckObjects.set(otherIngredient, constraint);
			}
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
	if (!isDragging) {
		highlightedObjects = [];

		const intersects = raycaster.intersectObjects(sushiIngredients.map(item => item.mesh));
		if (intersects.length > 0 && (currentMode === 'interact-move' || currentMode === 'interact-pinch' || currentMode === 'interact-delete')) {
			const hoveredObject = intersects[0].object;
			const hoveredIngredient = sushiIngredients.find(item => item.mesh === hoveredObject);

			if (currentMode === 'interact-move' || currentMode === 'interact-delete') {
				if (hoveredIngredient.type === 'rice') {
					// Select all rice grains within the selection radius
					const riceSelectionRadius = currentMode === 'interact-delete' ? RICE_DELETION_RADIUS : RICE_SELECTION_RADIUS;
					sushiIngredients.forEach(ingredient => {
						if (ingredient.type === 'rice' && ingredient.mesh.position.distanceTo(hoveredObject.position) <= riceSelectionRadius) {
							highlightedObjects.push(ingredient);
						}
					});
				} else {
					// For other object types, select all parts of the specific logical object
					const objectId = hoveredIngredient.objectId;
					sushiIngredients.forEach(ingredient => {
						if (ingredient.objectId === objectId) {
							highlightedObjects.push(ingredient);
						}
					});
				}
			} else if (currentMode === 'interact-pinch') {
				// Select only the clicked object
				highlightedObjects.push(hoveredIngredient);
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
			renderer.domElement.style.cursor = isDragging ? 'grabbing' : (highlightedObjects.length ? 'grab' : 'default');
			break;
		case 'interact-pinch':
			renderer.domElement.style.cursor = isDragging ? 'grabbing' : (highlightedObjects.length ? 'grab' : 'default');
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
		selectedObjects = highlightedObjects.slice();
		dragStartOffsets = [];
		const selectedIngredientType = selectedObjects[0].type;

		if (currentMode === 'interact-move' || currentMode === 'interact-pinch') {
			if (selectedIngredientType === 'rice') {
				// Break connections between the dragged rice and other objects
				// TODO: prevent connections from re-forming while dragging
				selectedObjects.forEach(rice => {
					if (rice.stuckObjects) {
						rice.stuckObjects.forEach((constraint, otherIngredient) => {
							if (!selectedObjects.includes(otherIngredient)) {
								world.removeConstraint(constraint);
								rice.stuckObjects.delete(otherIngredient);
							}
						});
					}
				});
			}

			isDragging = true;
			controls.enabled = false;

			// Store the initial offsets for all selected objects
			const intersection = new THREE.Vector3();
			raycaster.ray.intersectPlane(groundPlane, intersection);
			selectedObjects.forEach(object => {
				const offset = new THREE.Vector3().subVectors(object.mesh.position, intersection);
				dragStartOffsets.push(offset);
			});

			// Show rotate buttons for touch devices
			if ('ontouchstart' in window) {
				document.getElementById('toolbar').style.display = 'none';
				document.getElementById('rotate-buttons').style.display = 'flex';
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
	// It would probably be better to count everything from the current state every time (adding and removing)
	const isGroup = ["nori", "bamboo"].includes(objectsToDelete[0].type);
	objectsToDelete.forEach(ingredient => {
		scene.remove(ingredient.mesh);
		world.removeBody(ingredient.body);
		if (!isGroup) {
			updateIngredientCounter(ingredient.type, -1);
		}
	});
	if (isGroup) {
		updateIngredientCounter(objectsToDelete[0].type, -1);
	}
	sushiIngredients = sushiIngredients.filter(ingredient => !objectsToDelete.includes(ingredient));
}

function onPointerMove(event) {
	updateHover(event);
}

function onPointerUp(event) {
	isDragging = false;
	selectedObjects = [];
	dragStartOffsets = [];
	controls.enabled = true;
	updateCursor();

	// Hide rotate buttons and show toolbar for touch devices
	if ('ontouchstart' in window) {
		document.getElementById('toolbar').style.display = 'flex';
		document.getElementById('rotate-buttons').style.display = 'none';
	}
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

	riceBody.addEventListener("collide", handleCollision);

	scene.add(riceMesh);
	world.addBody(riceBody);
	sushiIngredients.push({ mesh: riceMesh, body: riceBody, type: 'rice', stuckObjects: new Map(), objectId: Date.now() });

	updateIngredientCounter('rice', 1);
}

function addNori() {
	const noriWidth = 1;
	const noriHeight = 0.01;
	const noriDepth = 1;
	const segments = 10;
	const objectId = Date.now();

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

		noriBody.addEventListener("collide", handleCollision);

		if (i > 0) {
			const constraint = new CANNON.HingeConstraint(
				sushiIngredients[sushiIngredients.length - 1].body,
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
		sushiIngredients.push({ mesh: noriMesh, body: noriBody, type: 'nori', objectId });
	}

	updateIngredientCounter('nori', 1);
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

	fishBody.addEventListener("collide", handleCollision);

	scene.add(fishMesh);
	world.addBody(fishBody);
	sushiIngredients.push({ mesh: fishMesh, body: fishBody, type: 'fish', objectId: Date.now() });

	updateIngredientCounter('fish', 1);
}

function addBambooMat() {
	const matWidth = 1.5;
	const matHeight = 0.01;
	const matDepth = 1;
	const segments = 15;
	const objectId = Date.now();

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

		// TODO: remove redundant collision event listeners; only rice sticks, only rice needs it! so dumb
		bambooBody.addEventListener("collide", handleCollision);

		if (i > 0) {
			const constraint = new CANNON.HingeConstraint(
				sushiIngredients[sushiIngredients.length - 1].body,
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
		sushiIngredients.push({ mesh: bambooMesh, body: bambooBody, type: 'bamboo', objectId });
	}

	updateIngredientCounter('bamboo', 1);
}

function updateIngredientCounter(type, change) {
	counts[type] += change;
	document.getElementById(type + '-count').textContent = counts[type];
}

function animate() {
	requestAnimationFrame(animate);
	world.step(timeStep);

	sushiIngredients.forEach(ingredient => {
		ingredient.mesh.position.copy(ingredient.body.position);
		ingredient.mesh.quaternion.copy(ingredient.body.quaternion);

		// Check and break constraints if necessary
		if (ingredient.stuckObjects) {
			for (let [otherIngredient, constraint] of ingredient.stuckObjects.entries()) {
				if (constraint.equations[0].multiplier > constraintBreakThreshold) {
					world.removeConstraint(constraint);
					ingredient.stuckObjects.delete(otherIngredient);
				}
			}
		}
	});

	if (isDragging && selectedObjects.length > 0) {

		liftFraction += timeStep / liftDuration;
		liftFraction = Math.min(liftFraction, 1);

		const intersection = new THREE.Vector3();
		raycaster.ray.intersectPlane(groundPlane, intersection);

		selectedObjects.forEach((object, index) => {
			const targetPosition = new THREE.Vector3().addVectors(intersection, dragStartOffsets[index]);
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
