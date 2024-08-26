
import * as THREE from 'three';
import { OrbitControls } from './libs/OrbitControls.js';
import * as CANNON from './libs/cannon-es.js';

let scene, camera, renderer, world, controls, raycaster, mouse;
let timeStep = 1 / 60;
let sushiIngredients = [];
let riceCount = 0;
let noriCount = 0;
let fishCount = 0;
let bambooCount = 0;
let currentMode = 'interact-move';
let selectedObjects = [];
let isDragging = false;
let dragPlane;
let dragPlaneMesh;
let debugMesh;
let highlightedObject = null;
let debugVisualizationEnabled = false;
let groundPlane;
let dragStartOffsets = [];
let constraintBreakThreshold = 1;
let riceSize = 0.05;
let dragPlaneHeight = 0.1;
let rotationAngle = 0;
let rotationSpeed = 0.05;

const RICE_SELECTION_RADIUS = 0.2;
const RICE_DELETION_RADIUS = 0.3;

function init() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('scene-container').appendChild(renderer.domElement);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(10, 20, 10);
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
  scene.add(groundMesh);

  groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -dragPlaneHeight);

  const dragPlaneGeometry = new THREE.PlaneGeometry(10, 10);
  const dragPlaneMaterial = new THREE.MeshBasicMaterial({
	color: 0x00ff00,
	transparent: true,
	opacity: 0.2,
	side: THREE.DoubleSide
  });
  dragPlaneMesh = new THREE.Mesh(dragPlaneGeometry, dragPlaneMaterial);
  dragPlaneMesh.visible = false;
  dragPlaneMesh.name = 'dragPlane';
  scene.add(dragPlaneMesh);

  const debugGeometry = new THREE.SphereGeometry(0.05, 32, 32);
  const debugMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  debugMesh = new THREE.Mesh(debugGeometry, debugMaterial);
  debugMesh.visible = false;
  debugMesh.name = 'debugMesh';
  scene.add(debugMesh);

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
	updateDebugVisualization();
  });

  document.getElementById('constraint-threshold').addEventListener('input', (e) => {
	constraintBreakThreshold = parseFloat(e.target.value);
  });

  document.getElementById('rice-size').addEventListener('input', (e) => {
	riceSize = parseFloat(e.target.value);
  });

  document.getElementById('drag-plane-height').addEventListener('input', (e) => {
	dragPlaneHeight = parseFloat(e.target.value);
	dragPlane.constant = -dragPlaneHeight;
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

	selectedObjects.forEach(obj => {
	  const localPos = obj.mesh.position.sub(center);
	  localPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
	  obj.mesh.position.copy(localPos.add(center));
	  obj.body.position.copy(obj.mesh.position);
	  obj.mesh.rotateY(angle);
	  obj.body.quaternion.copy(obj.mesh.quaternion);
	});
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

  if (mode === 'camera-pan') {
	controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
  } else if (mode === 'camera-zoom') {
	controls.mouseButtons.LEFT = THREE.MOUSE.DOLLY;
  } else if (mode === 'interact-move' || mode === 'interact-pinch' || mode === 'interact-delete') {
	controls.mouseButtons.LEFT = null;
  }

  updateDebugVisualization();
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
	  renderer.domElement.style.cursor = isDragging ? 'grabbing' : (highlightedObject ? 'grab' : 'default');
	  break;
	case 'interact-pinch':
	  renderer.domElement.style.cursor = isDragging ? 'grabbing' : (highlightedObject ? 'grab' : 'default');
	  break;
	case 'interact-delete':
	  renderer.domElement.style.cursor = 'crosshair';
	  break;
  }
}

function updateDebugVisualization() {
  debugMesh.visible = debugVisualizationEnabled && (currentMode === 'interact-move' || currentMode === 'interact-pinch' || currentMode === 'interact-delete');
}

function updatePointerAndRaycaster(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
}

function onPointerDown(event) {
  event.preventDefault();
  updatePointerAndRaycaster(event);

  const intersects = raycaster.intersectObjects(sushiIngredients.map(item => item.mesh));

  if (intersects.length > 0) {
	if (currentMode === 'interact-move' || currentMode === 'interact-pinch') {
	  selectedObjects = [];
	  dragStartOffsets = [];
	  const selectedObject = intersects[0].object;
	  const selectedIngredient = sushiIngredients.find(item => item.mesh === selectedObject);

	  if (currentMode === 'interact-move') {
		if (selectedIngredient.type === 'rice') {
		  // Select all rice grains within the selection radius
		  sushiIngredients.forEach(ingredient => {
			if (ingredient.type === 'rice' && ingredient.mesh.position.distanceTo(selectedObject.position) <= RICE_SELECTION_RADIUS) {
			  selectedObjects.push(ingredient);
			}
		  });
		  // Break connections between the dragged rice and other objects
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
		} else {
		  // For other ingredients, select all parts of the specific logical object
		  const objectId = selectedIngredient.objectId;
		  sushiIngredients.forEach(ingredient => {
			if (ingredient.objectId === objectId) {
			  selectedObjects.push(ingredient);
			}
		  });
		}
	  } else if (currentMode === 'interact-pinch') {
		// Select only the clicked object
		selectedObjects.push(selectedIngredient);
	  }

	  isDragging = true;
	  controls.enabled = false;

	  dragPlaneMesh.position.set(0, dragPlaneHeight, 0);
	  dragPlaneMesh.visible = debugVisualizationEnabled;

	  // Store the initial offsets for all selected objects
	  const intersection = new THREE.Vector3();
	  raycaster.ray.intersectPlane(dragPlane, intersection);
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
	  const deletedObject = intersects[0].object;
	  const deletedIngredient = sushiIngredients.find(item => item.mesh === deletedObject);

	  if (deletedIngredient.type === 'rice') {
		// Delete all rice grains within the deletion radius
		const objectsToDelete = sushiIngredients.filter(ingredient => 
		  ingredient.type === 'rice' && ingredient.mesh.position.distanceTo(deletedObject.position) <= RICE_DELETION_RADIUS
		);
		deleteObjects(objectsToDelete);
	  } else {
		// For other ingredients, delete all parts of the specific logical object
		const objectsToDelete = sushiIngredients.filter(ingredient => ingredient.objectId === deletedIngredient.objectId);
		deleteObjects(objectsToDelete);
	  }
	}
  }
  updateCursor();
}

function deleteObjects(objectsToDelete) {
  objectsToDelete.forEach(ingredient => {
	scene.remove(ingredient.mesh);
	world.removeBody(ingredient.body);
	updateIngredientCounter(ingredient.type, -1);
  });
  sushiIngredients = sushiIngredients.filter(ingredient => !objectsToDelete.includes(ingredient));
}

function onPointerMove(event) {
  updatePointerAndRaycaster(event);

  if (debugMesh.visible) {
	const intersects = raycaster.intersectObjects(scene.children.filter(obj => obj.name !== 'debugMesh' && obj.name !== 'ground' && obj.name !== 'dragPlane'));
	if (intersects.length > 0) {
	  debugMesh.position.copy(intersects[0].point);
	}
  }

  const intersects = raycaster.intersectObjects(sushiIngredients.map(item => item.mesh));
  if (intersects.length > 0) {
	if (highlightedObject && highlightedObject !== intersects[0].object) {
	  highlightedObject.material.emissive.setHex(0x000000);
	}
	highlightedObject = intersects[0].object;
	highlightedObject.material.emissive.setHex(0x444444);
  } else if (highlightedObject) {
	highlightedObject.material.emissive.setHex(0x000000);
	highlightedObject = null;
  }
  updateCursor();
}

function onPointerUp(event) {
  isDragging = false;
  selectedObjects = [];
  dragStartOffsets = [];
  controls.enabled = true;
  dragPlaneMesh.visible = false;
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

	const bambooShape = new CANNON.Box(new CANNON.Vec3(segmentWidth / 2, matHeight / 2, matDepth / 2));
	const bambooBody = new CANNON.Body({
	  mass: 0.05,
	  shape: bambooShape,
	  position: new CANNON.Vec3((i - segments / 2) * segmentWidth, 5, Math.random() * 2 - 1)
	});

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
  switch (type) {
	case 'rice':
	  riceCount += change;
	  document.getElementById('rice-count').textContent = riceCount;
	  break;
	case 'nori':
	  noriCount += change;
	  document.getElementById('nori-count').textContent = noriCount;
	  break;
	case 'fish':
	  fishCount += change;
	  document.getElementById('fish-count').textContent = fishCount;
	  break;
	case 'bamboo':
	  bambooCount += change;
	  document.getElementById('bamboo-count').textContent = bambooCount;
	  break;
  }
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
	const intersection = new THREE.Vector3();
	raycaster.ray.intersectPlane(dragPlane, intersection);
	
	selectedObjects.forEach((object, index) => {
	  const targetPosition = new THREE.Vector3().addVectors(intersection, dragStartOffsets[index]);
	  object.mesh.position.copy(targetPosition);
	  object.body.position.copy(targetPosition);
	  object.body.velocity.set(0, 0, 0);
	  object.body.angularVelocity.set(0, 0, 0);
	});
	
	dragPlaneMesh.position.copy(intersection);
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
