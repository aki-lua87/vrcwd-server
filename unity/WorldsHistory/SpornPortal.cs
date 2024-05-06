
using UdonSharp;
using UnityEngine;
using VRC.SDKBase;
using VRC.Udon;
using VRC.SDK3.Components;

namespace aki.Lua87
{

    public class SpornPortal : UdonSharpBehaviour
    {
        private readonly string logPrefix = $"[aki_lua87] {typeof(SpornPortal)}: ";
        [SerializeField] private GameObject vrcPortalMarkerGameObjectPrefab;
        private GameObject spornPortalGameObject;
        public string worldid;
        private bool isEnable;

        public void Start()
        {
            Debug.Log($"{logPrefix} Start");
            isEnable = false;
            spornPortalGameObject = Instantiate(vrcPortalMarkerGameObjectPrefab, Vector3.zero, Quaternion.identity, this.transform);
            spornPortalGameObject.transform.localPosition = new Vector3(0, 0, 0);
            spornPortalGameObject.SetActive(false);
        }

        public void OnPlayerTriggerEnter(VRCPlayerApi player)
        {
            Debug.Log($"{logPrefix} OnPlayerTriggerEnter" + player.displayName);
            if (isEnable)
            {
                return;
            }
            EnablePortal();
        }

        public void EnablePortal()
        {
            isEnable = true;
            var vrcPortalMarker = spornPortalGameObject.GetComponent<VRCPortalMarker>();
            vrcPortalMarker.roomId = worldid;
            spornPortalGameObject.SetActive(true);
            // vrcPortalMarker.RefreshPortal();
        }
    }
}
